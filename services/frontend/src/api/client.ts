/**
 * Central fetch wrapper for F.R.A.M.E. API communication.
 *
 * - Stores JWT in memory only (never localStorage)
 * - Auto-attaches Bearer token to authenticated requests
 * - Enforces HTTPS in production
 * - Handles 401 → refresh → retry once
 */

import type { RefreshResponse, ApiError } from '@frame/shared/api';

// ── Token storage (in-memory only — cleared on page reload) ──

let accessToken: string | null = null;
let refreshTokenValue: string | null = null;

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
    process.env.REACT_APP_HOMESERVER_URL ?? 'http://localhost:8080';

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

// ── Refresh logic ──

let refreshPromise: Promise<void> | null = null;

async function performRefresh(): Promise<void> {
  if (!refreshTokenValue) {
    clearTokens();
    throw new Error('No refresh token available');
  }

  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshTokenValue }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Token refresh failed');
  }

  const data: RefreshResponse = await res.json();
  accessToken = data.accessToken;
}

/**
 * Ensures only one refresh request is in flight at a time.
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
      errorBody = await res.json();
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
