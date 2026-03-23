/**
 * ProfileSettings — Edit user display name.
 *
 * Shows the current display name with an edit input.
 * Calls PUT /auth/profile to persist changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getProfile, updateProfile, updateStatus } from '../api/authAPI';
import type { UserStatus } from '../api/authAPI';
import { getBlockedUsers, unblockUser } from '../api/blocksAPI';
import { useIsMobile } from '../hooks/useIsMobile';

interface ProfileSettingsProps {
  userId: string;
  /** Called when the user successfully updates their display name */
  onDisplayNameChange?: (name: string) => void;
  /** Called when the user successfully updates their status */
  onStatusChange?: (status: UserStatus) => void;
  /** Called when the user updates their status message */
  onStatusMessageChange?: (message: string) => void;
  /** Called when the user blocks or unblocks someone, so parent can refresh blocked list and rooms */
  onBlockStatusChanged?: () => void;
  /** Toast notification callback */
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
}

const STATUS_OPTIONS: { value: UserStatus; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: '#3fb950' },
  { value: 'away', label: 'Away', color: '#d29922' },
  { value: 'busy', label: 'Busy', color: '#f85149' },
  { value: 'offline', label: 'Offline', color: '#484f58' },
];

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ userId, onDisplayNameChange, onStatusChange, onStatusMessageChange, onBlockStatusChanged, showToast }) => {
  const isMobile = useIsMobile(600);
  const [displayName, setDisplayName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status state
  const [currentStatus, setCurrentStatus] = useState<UserStatus>('online');
  const [statusMessage, setStatusMessage] = useState('');
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Load profile on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getProfile();
        if (!cancelled) {
          const effectiveName = profile.displayName || (userId.startsWith('@') ? userId.slice(1).split(':')[0] : userId);
          setDisplayName(profile.displayName || '');
          setEditValue(profile.displayName || '');
          onDisplayNameChange?.(effectiveName);
          if (profile.status) {
            setCurrentStatus(profile.status);
            onStatusChange?.(profile.status);
          }
          if (profile.statusMessage) {
            setStatusMessage(profile.statusMessage);
            onStatusMessageChange?.(profile.statusMessage);
          }
        }
      } catch {
        // Profile fetch failed — use userId as fallback
        if (!cancelled) {
          const fallback = userId.startsWith('@') ? userId.slice(1).split(':')[0] : userId;
          setDisplayName(fallback);
          setEditValue(fallback);
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, onDisplayNameChange, onStatusChange, onStatusMessageChange]);

  // Load blocked users on mount
  useEffect(() => {
    let cancelled = false;
    setLoadingBlocked(true);
    getBlockedUsers()
      .then((users) => { if (!cancelled) setBlockedUsers(users); })
      .catch(() => { /* ignore — may not be supported */ })
      .finally(() => { if (!cancelled) setLoadingBlocked(false); });
    return () => { cancelled = true; };
  }, []);

  const handleUnblock = useCallback(async (blockedUserId: string) => {
    setUnblockingId(blockedUserId);
    try {
      await unblockUser(blockedUserId);
      setBlockedUsers((prev) => prev.filter((id) => id !== blockedUserId));
      showToast?.('success', 'User unblocked', { duration: 3000 });
      // Notify parent to refresh blocked users list and room list
      onBlockStatusChanged?.();
    } catch (err) {
      showToast?.('error', err instanceof Error ? err.message : 'Failed to unblock user', { duration: 5000 });
    } finally {
      setUnblockingId(null);
    }
  }, [onBlockStatusChanged]);

  const handleStatusChange = useCallback(async (newStatus: UserStatus) => {
    setIsSavingStatus(true);
    try {
      await updateStatus(newStatus, statusMessage || undefined);
      setCurrentStatus(newStatus);
      onStatusChange?.(newStatus);
      showToast?.('success', `Status changed to ${newStatus}`, { duration: 3000, dedupeKey: 'status-change' });
    } catch (err) {
      showToast?.('error', err instanceof Error ? err.message : 'Failed to update status', { duration: 5000 });
    } finally {
      setIsSavingStatus(false);
    }
  }, [statusMessage, onStatusChange]);

  const handleStatusMessageSave = useCallback(async () => {
    setIsSavingStatus(true);
    try {
      await updateStatus(currentStatus, statusMessage || undefined);
      onStatusMessageChange?.(statusMessage || '');
      showToast?.('success', 'Status message updated', { duration: 3000, dedupeKey: 'status-msg-save' });
    } catch (err) {
      showToast?.('error', err instanceof Error ? err.message : 'Failed to update status', { duration: 5000 });
    } finally {
      setIsSavingStatus(false);
    }
  }, [currentStatus, statusMessage, onStatusMessageChange]);

  const handleSave = useCallback(async () => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      setError('Display name cannot be empty');
      return;
    }
    if (trimmed === displayName) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const result = await updateProfile(trimmed);
      setDisplayName(result.displayName);
      setEditValue(result.displayName);
      setIsEditing(false);
      onDisplayNameChange?.(result.displayName);
      showToast?.('success', 'Display name saved', { duration: 3000 });
    } catch (err) {
      showToast?.('error', err instanceof Error ? err.message : 'Failed to update profile', { duration: 5000 });
    } finally {
      setIsSaving(false);
    }
  }, [editValue, displayName, onDisplayNameChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(displayName);
      setError(null);
    }
  }, [handleSave, displayName]);

  // Derive initials for avatar
  const initials = (displayName || userId)
    .replace(/^@/, '')
    .charAt(0)
    .toUpperCase();

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { maxWidth: '100%', padding: '16px 0' } : {}),
    }}>
      <h3 style={styles.heading}>Profile</h3>

      <div style={{
        ...styles.profileCard,
        ...(isMobile ? { flexDirection: 'column' as const, alignItems: 'center', gap: 12, padding: '20px 14px' } : {}),
      }}>
        {/* Avatar */}
        <div style={{
          ...styles.avatar,
          ...(isMobile ? { width: 64, height: 64, fontSize: 28 } : {}),
        }}>
          {initials}
        </div>

        <div style={{
          ...styles.infoColumn,
          ...(isMobile ? { width: '100%' } : {}),
        }}>
          {/* Display name */}
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Display Name</label>
            {isEditing ? (
              <div style={{
                ...styles.editRow,
                ...(isMobile ? { flexDirection: 'column' as const, gap: 8 } : {}),
              }}>
                <input
                  type="text"
                  style={{
                    ...styles.editInput,
                    ...(isMobile ? { width: '100%', minHeight: 44, fontSize: 15, padding: '10px 12px' } : {}),
                  }}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={64}
                  autoFocus
                  disabled={isSaving}
                />
                <div style={{
                  display: 'flex',
                  gap: 8,
                  ...(isMobile ? { width: '100%' } : {}),
                }}>
                  <button
                    type="button"
                    style={{
                      ...styles.saveButton,
                      ...(isMobile ? { flex: 1, minHeight: 44, fontSize: 14 } : {}),
                    }}
                    onClick={() => void handleSave()}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    style={{
                      ...styles.cancelButton,
                      ...(isMobile ? { flex: 1, minHeight: 44, fontSize: 14 } : {}),
                    }}
                    onClick={() => {
                      setIsEditing(false);
                      setEditValue(displayName);
                      setError(null);
                    }}
                    disabled={isSaving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div style={styles.displayRow}>
                <span style={styles.displayNameText}>
                  {displayName || (userId.startsWith('@') ? userId.slice(1).split(':')[0] : userId) || 'Not set'}
                </span>
                <button
                  type="button"
                  style={{
                    ...styles.editButton,
                    ...(isMobile ? { minHeight: 44, minWidth: 44, padding: '6px 14px', fontSize: 13 } : {}),
                  }}
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* User ID (read-only, with copy button) */}
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Your User ID</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={styles.userIdText}>{userId}</span>
              <button
                type="button"
                style={{
                  ...styles.editButton,
                  ...(isMobile ? { minHeight: 44, minWidth: 44, padding: '6px 14px', fontSize: 13 } : {}),
                }}
                onClick={() => {
                  navigator.clipboard.writeText(userId).then(() => {
                    showToast?.('success', 'User ID copied', { duration: 3000 });
                  }).catch(() => {
                    showToast?.('error', 'Failed to copy User ID', { duration: 5000 });
                  });
                }}
                title="Copy User ID"
                aria-label="Copy User ID"
              >
                Copy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Status section */}
      <div style={{
        ...styles.profileCard,
        marginTop: 12,
        ...(isMobile ? { padding: '16px 14px' } : {}),
      }}>
        <div style={{
          ...styles.infoColumn,
          ...(isMobile ? { width: '100%' } : {}),
        }}>
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Status</label>
            <div style={{
              display: 'flex',
              gap: 6,
              ...(isMobile ? {
                display: 'grid' as const,
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
              } : {}),
            }}>
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  style={{
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: currentStatus === opt.value ? `1px solid ${opt.color}` : '1px solid #30363d',
                    backgroundColor: currentStatus === opt.value ? `${opt.color}20` : 'transparent',
                    color: currentStatus === opt.value ? opt.color : '#8b949e',
                    cursor: isSavingStatus ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    transition: 'all 0.15s',
                    ...(isMobile ? { minHeight: 44, fontSize: 13, padding: '8px 12px' } : {}),
                  }}
                  onClick={() => void handleStatusChange(opt.value)}
                  disabled={isSavingStatus}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: opt.color, display: 'inline-block' }} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Status Message</label>
            <div style={{
              ...styles.editRow,
              ...(isMobile ? { flexDirection: 'column' as const, gap: 8 } : {}),
            }}>
              <input
                type="text"
                style={{
                  ...styles.editInput,
                  ...(isMobile ? { width: '100%', minHeight: 44, fontSize: 15, padding: '10px 12px' } : {}),
                }}
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleStatusMessageSave(); } }}
                maxLength={128}
                placeholder="What are you up to?"
                disabled={isSavingStatus}
              />
              <button
                type="button"
                style={{
                  ...styles.saveButton,
                  ...(isMobile ? { width: '100%', minHeight: 44, fontSize: 14 } : {}),
                }}
                onClick={() => void handleStatusMessageSave()}
                disabled={isSavingStatus}
              >
                {isSavingStatus ? 'Saving...' : 'Set'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Blocked Users section */}
      <div style={{
        ...styles.profileCard,
        marginTop: 12,
        ...(isMobile ? { padding: '16px 14px' } : {}),
      }}>
        <div style={{
          ...styles.infoColumn,
          ...(isMobile ? { width: '100%' } : {}),
        }}>
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Blocked Users</label>
            {loadingBlocked ? (
              <span style={{ fontSize: 12, color: '#8b949e' }}>Loading...</span>
            ) : blockedUsers.length === 0 ? (
              <span style={{ fontSize: 12, color: '#6e7681', fontStyle: 'italic' }}>No blocked users</span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                {blockedUsers.map((uid) => (
                  <div key={uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
                    <span style={{ fontSize: 13, color: '#c9d1d9', fontFamily: '"SF Mono", "Fira Code", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1 }}>{uid}</span>
                    <button
                      type="button"
                      style={{
                        padding: '4px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: 'rgba(35, 134, 54, 0.1)',
                        color: '#3fb950',
                        border: '1px solid rgba(35, 134, 54, 0.3)',
                        borderRadius: 4,
                        cursor: unblockingId === uid ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                        flexShrink: 0,
                        opacity: unblockingId === uid ? 0.6 : 1,
                        ...(isMobile ? { minHeight: 36, padding: '6px 14px', fontSize: 13 } : {}),
                      }}
                      disabled={unblockingId === uid}
                      onClick={() => void handleUnblock(uid)}
                    >
                      {unblockingId === uid ? 'Unblocking...' : 'Unblock'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '100%',
    maxWidth: 440,
    padding: '20px 0',
  },
  heading: {
    margin: '0 0 16px',
    fontSize: 16,
    fontWeight: 600,
    color: '#e6edf3',
  },
  profileCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 16,
    padding: 16,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    backgroundColor: '#30363d',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 700,
    color: '#58a6ff',
    flexShrink: 0,
  },
  infoColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
    minWidth: 0,
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#8b949e',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  displayRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  displayNameText: {
    fontSize: 15,
    fontWeight: 600,
    color: '#e6edf3',
  },
  editButton: {
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: '#58a6ff',
    border: '1px solid #30363d',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  },
  editRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  editInput: {
    flex: 1,
    padding: '6px 10px',
    fontSize: 14,
    borderRadius: 6,
    border: '1px solid #58a6ff',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontFamily: 'inherit',
    outline: 'none',
  },
  saveButton: {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  cancelButton: {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#8b949e',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  userIdText: {
    fontSize: 13,
    color: '#8b949e',
    fontFamily: '"SF Mono", "Fira Code", monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  errorBanner: {
    marginTop: 8,
    padding: '6px 12px',
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    fontSize: 12,
    color: '#f85149',
  },
};

export default ProfileSettings;
