/**
 * Central fetch wrapper for F.R.A.M.E. API communication.
 *
 * - Stores JWT in memory only (never localStorage)
 * - Auto-attaches Bearer token to authenticated requests
 * - Enforces HTTPS in production
 * - Handles 401 → refresh → retry once
 * - Coalesces concurrent refresh requests into a single network call
 */

import type { RefreshResponse, ApiError } from '@frame/shared';

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
    try { await fetch(getBaseUrl() + '/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + accessToken } }); } catch { /* logout best-effort */ }
    clearTokens();
    throw new FrameApiError(401, {
      error: { code: 'M_SESSION_EXPIRED', message: 'Session timed out due to inactivity' },
    });
  }
}

// ── Refresh logic ──

let refreshPromise: Promise<void> | null = null;

async function performRefresh(): Promise<void> {
  if (!refreshTokenValue) {
    clearTokens();
    throw new Error('No refresh token available');
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
    throw new Error('Token refresh failed');
  }

  let data: RefreshResponse;
  try {
    data = (await res.json()) as RefreshResponse;
  } catch {
    // Response parse failed — the server already rotated the token,
    // so the old one is invalid. Clear everything.
    isRefreshing = false;
    clearTokens();
    throw new Error('Token refresh failed — invalid response');
  }

  // Validate that the response contains the expected token fields
  if (!data.accessToken || !data.refreshToken) {
    isRefreshing = false;
    clearTokens();
    throw new Error('Token refresh failed — missing tokens in response');
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
}

/**
 * Central fetch wrapper. All API calls go through here.
 *
 * @param endpoint  Path relative to base URL, e.g. "/auth/login"
 * @param options   Method, body, headers, auth flag
 * @returns         Parsed JSON response body
 */
export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = 'GET', body, headers = {}, noAuth = false } = options;

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

  let res = await doFetch();

  // If 401 and we have a refresh token, try refreshing once and retry
  if (res.status === 401 && !noAuth && refreshTokenValue) {
    try {
      await refreshAccessToken();
    } catch {
      throw new FrameApiError(401, {
        error: { code: 'M_UNAUTHORIZED', message: 'Session expired' },
      });
    }
    res = await doFetch();
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
    throw new FrameApiError(res.status, errorBody);
  }

  // 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}
