/**
 * Privacy preferences for read receipts and typing indicators.
 *
 * These preferences are stored in localStorage and control whether the client
 * sends read receipts and typing indicators to the server.
 *
 * Privacy note — even when enabled:
 * - Read receipts are intentionally sent unencrypted because the server needs
 *   to track delivery state (which event was read by whom) to update the
 *   delivery_state column and relay receipts to other room members.
 * - Typing indicators reveal "user X is typing in room Y" metadata to the
 *   server. They are ephemeral (stored in Redis with a 30-second TTL) and
 *   not persisted, but the server can observe this metadata in transit.
 *
 * Users who disable these options will not send receipts/indicators at all,
 * following the same approach used by Signal and WhatsApp.
 */

const SEND_READ_RECEIPTS_KEY = 'frame:privacy:sendReadReceipts';
const SEND_TYPING_INDICATORS_KEY = 'frame:privacy:sendTypingIndicators';

/**
 * Returns whether the user has opted in to sending read receipts.
 * Default: true (enabled).
 */
export function getSendReadReceipts(): boolean {
  try {
    const stored = localStorage.getItem(SEND_READ_RECEIPTS_KEY);
    if (stored === null) return true;
    return stored === 'true';
  } catch {
    return true;
  }
}

/**
 * Persist the user's read receipt preference.
 */
export function setSendReadReceipts(enabled: boolean): void {
  try {
    localStorage.setItem(SEND_READ_RECEIPTS_KEY, String(enabled));
  } catch {
    // localStorage unavailable — preference won't persist
  }
}

/**
 * Returns whether the user has opted in to sending typing indicators.
 * Default: true (enabled).
 */
export function getSendTypingIndicators(): boolean {
  try {
    const stored = localStorage.getItem(SEND_TYPING_INDICATORS_KEY);
    if (stored === null) return true;
    return stored === 'true';
  } catch {
    return true;
  }
}

/**
 * Persist the user's typing indicator preference.
 */
export function setSendTypingIndicators(enabled: boolean): void {
  try {
    localStorage.setItem(SEND_TYPING_INDICATORS_KEY, String(enabled));
  } catch {
    // localStorage unavailable — preference won't persist
  }
}
