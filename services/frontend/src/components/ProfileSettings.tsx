/**
 * ProfileSettings — Edit user display name.
 *
 * Shows the current display name with an edit input.
 * Calls PUT /auth/profile to persist changes.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getProfile, updateProfile, updateStatus } from '../api/authAPI';
import type { UserStatus } from '../api/authAPI';

interface ProfileSettingsProps {
  userId: string;
}

const STATUS_OPTIONS: { value: UserStatus; label: string; color: string }[] = [
  { value: 'online', label: 'Online', color: '#3fb950' },
  { value: 'away', label: 'Away', color: '#d29922' },
  { value: 'busy', label: 'Busy', color: '#f85149' },
  { value: 'offline', label: 'Offline', color: '#484f58' },
];

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ userId }) => {
  const [displayName, setDisplayName] = useState('');
  const [editValue, setEditValue] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Status state
  const [currentStatus, setCurrentStatus] = useState<UserStatus>('online');
  const [statusMessage, setStatusMessage] = useState('');
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  // Load profile on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getProfile();
        if (!cancelled) {
          setDisplayName(profile.displayName || '');
          setEditValue(profile.displayName || '');
          if (profile.status) {
            setCurrentStatus(profile.status);
          }
          if (profile.statusMessage) {
            setStatusMessage(profile.statusMessage);
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
  }, [userId]);

  const handleStatusChange = useCallback(async (newStatus: UserStatus) => {
    setIsSavingStatus(true);
    try {
      await updateStatus(newStatus, statusMessage || undefined);
      setCurrentStatus(newStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setIsSavingStatus(false);
    }
  }, [statusMessage]);

  const handleStatusMessageSave = useCallback(async () => {
    setIsSavingStatus(true);
    try {
      await updateStatus(currentStatus, statusMessage || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setIsSavingStatus(false);
    }
  }, [currentStatus, statusMessage]);

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
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  }, [editValue, displayName]);

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
    <div style={styles.container}>
      <h3 style={styles.heading}>Profile</h3>

      <div style={styles.profileCard}>
        {/* Avatar */}
        <div style={styles.avatar}>
          {initials}
        </div>

        <div style={styles.infoColumn}>
          {/* Display name */}
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Display Name</label>
            {isEditing ? (
              <div style={styles.editRow}>
                <input
                  type="text"
                  style={styles.editInput}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={64}
                  autoFocus
                  disabled={isSaving}
                />
                <button
                  type="button"
                  style={styles.saveButton}
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  style={styles.cancelButton}
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
            ) : (
              <div style={styles.displayRow}>
                <span style={styles.displayNameText}>
                  {displayName || 'Not set'}
                </span>
                <button
                  type="button"
                  style={styles.editButton}
                  onClick={() => setIsEditing(true)}
                >
                  Edit
                </button>
              </div>
            )}
          </div>

          {/* User ID (read-only) */}
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>User ID</label>
            <span style={styles.userIdText}>{userId}</span>
          </div>
        </div>
      </div>

      {/* Status section */}
      <div style={{ ...styles.profileCard, marginTop: 12 }}>
        <div style={styles.infoColumn}>
          <div style={styles.fieldRow}>
            <label style={styles.fieldLabel}>Status</label>
            <div style={{ display: 'flex', gap: 6 }}>
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
                    gap: 5,
                    transition: 'all 0.15s',
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
            <div style={styles.editRow}>
              <input
                type="text"
                style={styles.editInput}
                value={statusMessage}
                onChange={(e) => setStatusMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleStatusMessageSave(); } }}
                maxLength={128}
                placeholder="What are you up to?"
                disabled={isSavingStatus}
              />
              <button
                type="button"
                style={styles.saveButton}
                onClick={() => void handleStatusMessageSave()}
                disabled={isSavingStatus}
              >
                {isSavingStatus ? 'Saving...' : 'Set'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}
      {success && <div style={styles.successBanner}>Display name updated</div>}
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
  successBanner: {
    marginTop: 8,
    padding: '6px 12px',
    backgroundColor: 'rgba(35, 134, 54, 0.1)',
    border: '1px solid rgba(35, 134, 54, 0.3)',
    borderRadius: 6,
    fontSize: 12,
    color: '#3fb950',
  },
};

export default ProfileSettings;
