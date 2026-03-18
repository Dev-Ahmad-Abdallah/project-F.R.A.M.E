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
 * Log out — clears in-memory tokens.
 *
 * A future iteration may also call a server-side /auth/logout endpoint
 * to invalidate the refresh token server-side.
 */
export function logout(): void {
  clearTokens();
}
