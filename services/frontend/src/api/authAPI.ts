/**
 * Auth API functions for F.R.A.M.E.
 *
 * All requests go through the central client.ts fetch wrapper.
 */

import type {
  RegisterRequest,
  LoginRequest,
  AuthResponse,
  RefreshResponse,
} from '@frame/shared';

import {
  apiRequest,
  setTokens,
  clearTokens,
  getRefreshToken,
} from './client';

/**
 * Register a new account.
 *
 * Sends identity key material along with credentials so the homeserver
 * can store the initial key bundle.
 */
export async function register(
  params: RegisterRequest,
): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/auth/register', {
    method: 'POST',
    body: params,
    noAuth: true,
  });

  setTokens(data.accessToken, data.refreshToken);
  return data;
}

/**
 * Log in to an existing account.
 */
export async function login(params: LoginRequest): Promise<AuthResponse> {
  const data = await apiRequest<AuthResponse>('/auth/login', {
    method: 'POST',
    body: params,
    noAuth: true,
  });

  setTokens(data.accessToken, data.refreshToken);
  return data;
}

/**
 * Refresh the access token using the stored refresh token.
 */
export async function refreshToken(): Promise<RefreshResponse> {
  const rt = getRefreshToken();
  if (!rt) {
    throw new Error('No refresh token available');
  }

  const data = await apiRequest<RefreshResponse>('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rt },
    noAuth: true,
  });

  // Update both tokens — server rotates the refresh token on each use
  setTokens(data.accessToken, data.refreshToken);
  return data;
}

/**
 * Log out — invalidates server-side refresh tokens, then clears client tokens.
 *
 * If the server call fails (e.g. network error, expired token),
 * client tokens are still cleared to ensure local logout.
 */
export async function logout(): Promise<void> {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch {
    // Server-side revocation failed — still clear client tokens
  }
  clearTokens();
}
