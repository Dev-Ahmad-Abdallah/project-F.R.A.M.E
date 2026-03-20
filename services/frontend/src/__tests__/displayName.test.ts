/**
 * Tests for formatDisplayName utility.
 */

import { formatDisplayName } from '../utils/displayName';

describe('formatDisplayName', () => {
  it('extracts username from standard Matrix user ID', () => {
    expect(formatDisplayName('@alice:server.com')).toBe('alice');
  });

  it('extracts username with complex server name', () => {
    expect(formatDisplayName('@bob:matrix.example.org')).toBe('bob');
  });

  it('handles username with dots and dashes', () => {
    expect(formatDisplayName('@user-name.123:server')).toBe('user-name.123');
  });

  it('returns "Unknown" for empty string', () => {
    expect(formatDisplayName('')).toBe('Unknown');
  });

  it('returns the full string if no @ prefix', () => {
    expect(formatDisplayName('alice:server')).toBe('alice:server');
  });

  it('returns username part even if no colon (just @username)', () => {
    // Regex: /^@([^:]+)/ — matches everything after @ until : or end of string
    expect(formatDisplayName('@alice')).toBe('alice');
  });

  it('returns "Unknown" for undefined-like falsy input', () => {
    // TypeScript might not normally allow this, but test runtime safety
    expect(formatDisplayName('' as string)).toBe('Unknown');
  });

  it('handles @ with empty local part', () => {
    // "@:server" — regex /^@([^:]+)/ won't match since [^:]+ needs at least one char
    expect(formatDisplayName('@:server')).toBe('@:server');
  });

  it('handles just @', () => {
    expect(formatDisplayName('@')).toBe('@');
  });
});
