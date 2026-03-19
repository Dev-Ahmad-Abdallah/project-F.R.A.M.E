/**
 * Central fetch wrapper for F.R.A.M.E. API communication.
 *
 * - Stores JWT in memory only (never localStorage)
 * - Auto-attaches Bearer token to authenticated requests
 * - Enforces HTTPS in production
 * - Handles 401 → silent refresh → retry (user never notices)
 * - Handles 429 → queue + auto-retry after Retry-After delay
 * - Coalesces concurrent refresh requests into a single network call
 * - Never forces a page refresh — all recovery is automatic
 */

import type { RefreshResponse, ApiError } from '@frame/shared';
import { fireGlitch } from '../hooks/useGlitchEffect';

// ── Toast callback (set by App to show non-blocking notifications) ──

type ToastCallback = (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
let toastCallback: ToastCallback | null = null;

/**
 * Register a toast callback so the API client can show non-blocking
 * notifications (e.g. rate-limit warnings) without crashing the UI.
 */
export function setApiToastCallback(cb: ToastCallback): void {
  toastCallback = cb;
}

// ── Session-expired callback (set by App to redirect to login gracefully) ──

type SessionExpiredCallback = (message: string) => void;
let sessionExpiredCallback: SessionExpiredCallback | null = null;

/**
 * Register a callback invoked when the session is truly expired
 * (refresh token also failed). The App should show the login page
 * with the provided message — never a blank crash.
 */
export function setSessionExpiredCallback(cb: SessionExpiredCallback): void {
  sessionExpiredCallback = cb;
}

// ── Session timeout (configurable, default 30 minutes) ──

const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
let sessionTimeoutMs: number = DEFAULT_SESSION_TIMEOUT_MS;
let lastActivityTimestamp: number = Date.now();

/**
 * Update the session timeout duration. Pass 0 or Infinity for "never".
 */
export function setSessionTimeout(ms: number): void {
  sessionTimeoutMs = ms <= 0 ? Infinity : ms;
}

export function getSessionTimeout(): number {
  return sessionTimeoutMs;
}

// ── Token storage (in-memory only — cleared on page reload) ──

let accessToken: string | null = null;
let refreshTokenValue: string | null = null;

/** True while a token refresh is in progress — prevents timeout-clearing tokens mid-refresh */
let isRefreshing = false;

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  refreshTokenValue = refresh;
}

export function clearTokens(): void {
  accessToken = null;
  refreshTokenValue = null;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshTokenValue;
}

// ── Base URL ──

function getBaseUrl(): string {
  const url =
    process.env.REACT_APP_HOMESERVER_URL ?? 'http://localhost:3000';

  // Enforce HTTPS in production
  if (process.env.NODE_ENV === 'production' && url.startsWith('http://')) {
    throw new Error(
      'REACT_APP_HOMESERVER_URL must use HTTPS in production builds.',
    );
  }

  // Strip trailing slash for consistency
  return url.replace(/\/+$/, '');
}

// ── API error helper ──

export class FrameApiError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(status: number, body: ApiError) {
    super(body.error.message);
    this.name = 'FrameApiError';
    this.code = body.error.code;
    this.status = status;
  }
}

// ── Session timeout helpers ──

/**
 * Update the last activity timestamp. Called on every API request.
 */
function touchActivity(): void {
  lastActivityTimestamp = Date.now();
}

/**
 * Check whether the session has been idle longer than the timeout.
 * If so, clear tokens and throw an auth error.
 *
 * Skipped when a token refresh is in progress to avoid clearing
 * tokens mid-rotation (the root cause of the 401 refresh bug).
 */
async function checkSessionTimeout(): Promise<void> {
  if (isRefreshing) return;
  if (sessionTimeoutMs === Infinity) return;
  if (accessToken && Date.now() - lastActivityTimestamp > sessionTimeoutMs) {
    // Revoke server-side session before clearing local tokens
    const logoutToken = accessToken; // Capture before clearing
    try {
      await fetch(getBaseUrl() + '/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${logoutToken}`,
          'Content-Type': 'application/json',
        },
      });
    } catch { /* logout best-effort */ }
    clearTokens();
    throw new FrameApiError(401, {
      error: { code: 'M_SESSION_EXPIRED', message: 'Session timed out due to inactivity' },
    });
  }
}

// ── Rate limit queue ──

/** Global flag: true while a rate-limit wait is active */
let rateLimitWaitUntil = 0;

/**
 * If we are currently rate-limited, wait until the window expires.
 * Multiple concurrent callers will all wait for the same deadline.
 */
async function waitForRateLimit(): Promise<void> {
  const remaining = rateLimitWaitUntil - Date.now();
  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }
}

/**
 * Parse Retry-After header: supports both seconds (integer) and
 * HTTP-date formats. Defaults to `fallbackSeconds` if missing/invalid.
 */
function parseRetryAfter(res: Response, fallbackSeconds = 10): number {
  const header = res.headers.get('Retry-After');
  if (!header) return fallbackSeconds;

  const asNumber = Number(header);
  if (!Number.isNaN(asNumber) && asNumber > 0) {
    return Math.ceil(asNumber);
  }

  // Try HTTP-date format
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) {
    const seconds = Math.ceil((asDate - Date.now()) / 1000);
    return seconds > 0 ? seconds : fallbackSeconds;
  }

  return fallbackSeconds;
}

// ── Refresh logic ──

let refreshPromise: Promise<void> | null = null;

async function performRefresh(): Promise<void> {
  if (!refreshTokenValue) {
    // No refresh token — session is truly expired
    clearTokens();
    sessionExpiredCallback?.('Your session expired. Please sign in again.');
    throw new FrameApiError(401, {
      error: { code: 'M_SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' },
    });
  }

  isRefreshing = true;

  // Capture the token before the request so we can detect if it was
  // already rotated by another tab / concurrent call.
  const tokenToSend = refreshTokenValue;

  const baseUrl = getBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokenToSend }),
    });
  } catch (networkErr) {
    // Network failure — do NOT clear tokens so the user can retry later.
    isRefreshing = false;
    throw new Error('Token refresh failed — network error');
  }

  if (!res.ok) {
    isRefreshing = false;
    clearTokens();
    sessionExpiredCallback?.('Your session expired. Please sign in again.');
    throw new FrameApiError(401, {
      error: { code: 'M_SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' },
    });
  }

  let data: RefreshResponse;
  try {
    data = (await res.json()) as RefreshResponse;
  } catch {
    // Response parse failed — the server already rotated the token,
    // so the old one is invalid. Clear everything.
    isRefreshing = false;
    clearTokens();
    sessionExpiredCallback?.('Your session expired. Please sign in again.');
    throw new FrameApiError(401, {
      error: { code: 'M_SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' },
    });
  }

  // Validate that the response contains the expected token fields
  if (!data.accessToken || !data.refreshToken) {
    isRefreshing = false;
    clearTokens();
    sessionExpiredCallback?.('Your session expired. Please sign in again.');
    throw new FrameApiError(401, {
      error: { code: 'M_SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' },
    });
  }

  accessToken = data.accessToken;
  refreshTokenValue = data.refreshToken;
  // Reset activity timestamp so the session timeout restarts from now
  lastActivityTimestamp = Date.now();
  isRefreshing = false;
}

/**
 * Ensures only one refresh request is in flight at a time.
 * Concurrent callers share the same in-flight promise.
 */
async function refreshAccessToken(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// ── Core request function ──

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Set to true to skip attaching the Bearer token. */
  noAuth?: boolean;
  /** Maximum number of rate-limit retries (default: 3). */
  maxRetries?: number;
}

/**
 * Central fetch wrapper. All API calls go through here.
 *
 * - 429 responses are handled transparently: the request is queued and
 *   retried after the Retry-After period. A non-blocking toast is shown.
 * - 401 responses trigger a silent token refresh. If the refresh succeeds,
 *   the original request is retried and the user never notices.
 * - If the refresh token is also expired, the session-expired callback
 *   is invoked to show the login page with a friendly message.
 *
 * @param endpoint  Path relative to base URL, e.g. "/auth/login"
 * @param options   Method, body, headers, auth flag
 * @returns         Parsed JSON response body
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers = {}, noAuth = false, maxRetries = 3 } = options;

  // Check for session timeout before making the request
  if (!noAuth) {
    await checkSessionTimeout();
    touchActivity();
  }

  const baseUrl = getBaseUrl();

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (!noAuth && accessToken) {
      h['Authorization'] = `Bearer ${accessToken}`;
    }
    return h;
  };

  const doFetch = async (): Promise<Response> =>
    fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: buildHeaders(),
      body: body != null ? JSON.stringify(body) : undefined,
    });

  // Wait if a rate-limit window is active from a previous request
  await waitForRateLimit();

  let res = await doFetch();

  // ── Handle 401: silent token refresh + retry ──
  if (res.status === 401 && !noAuth && refreshTokenValue) {
    // Attempt silent refresh — user should never notice
    await refreshAccessToken();
    // Refresh succeeded — retry original request with new token
    res = await doFetch();
  }

  // ── Handle 429: rate limit with auto-retry ──
  if (res.status === 429) {
    let lastRes = res;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const retryAfterSec = parseRetryAfter(lastRes);
      rateLimitWaitUntil = Date.now() + retryAfterSec * 1000;

      // Trigger CRT glitch effect on rate limit
      fireGlitch();

      // Show a subtle toast — NOT a crash
      toastCallback?.('warning', `Slow down \u2014 retrying in ${retryAfterSec}s`, {
        dedupeKey: 'rate-limit',
        duration: retryAfterSec * 1000,
      });

      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));

      lastRes = await doFetch();
      if (lastRes.status !== 429) {
        res = lastRes;
        break;
      }

      // If this was the last attempt, propagate as res so error handling below applies
      if (attempt === maxRetries - 1) {
        res = lastRes;
      }
    }
  }

  if (!res.ok) {
    let errorBody: ApiError;
    try {
      errorBody = (await res.json()) as ApiError;
    } catch {
      errorBody = {
        error: { code: 'M_UNKNOWN', message: res.statusText },
      };
    }

    // For 401 after refresh already failed, the sessionExpiredCallback
    // was already called in performRefresh. Just throw for the caller.
    throw new FrameApiError(res.status, errorBody);
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}
