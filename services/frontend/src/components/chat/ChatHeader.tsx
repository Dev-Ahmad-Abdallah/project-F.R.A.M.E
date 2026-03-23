/* eslint-disable react/prop-types */
import React, { useRef, useState, useCallback, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../../utils/purifyConfig';
import { formatDisplayName } from '../../utils/displayName';
import { getUserStatus } from '../../api/authAPI';
import type { UserStatus } from '../../api/authAPI';
import { blockUser, unblockUser } from '../../api/blocksAPI';
// Room rename is stored locally (per-user nickname) — not sent to server
import { SyncIndicator } from '../Skeleton';
import { styles } from './chatStyles';

// ── Status helpers ──

const STATUS_COLORS: Record<UserStatus, string> = {
  online: '#3fb950',
  away: '#d29922',
  busy: '#f85149',
  offline: '#484f58',
};

const STATUS_LABELS: Record<UserStatus, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

// ── Avatar color helper ──
const AVATAR_COLORS = ['#da3633', '#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f78166'];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export interface ChatHeaderProps {
  roomId: string;
  currentUserId: string;
  memberUserIds: string[];
  roomDisplayName?: string;
  roomType?: 'direct' | 'group';
  memberCount?: number;
  isAnonymous?: boolean;
  isMobile: boolean;
  isSyncing: boolean;
  disappearingSettings: { enabled: boolean; timeoutSeconds: number } | null;
  showSearch: boolean;
  showDisappearingMenu: boolean;
  onToggleSearch: () => void;
  onToggleDisappearingMenu: () => void;
  onUpdateDisappearing: (seconds: number) => void;
  onLeave?: () => void;
  onOpenSettings?: () => void;
  onRoomRenamed?: (roomId: string, newName: string) => void;
  onShowMobileMoreMenu: () => void;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
  /** Set of user IDs the current user has blocked */
  blockedUserIds?: Set<string>;
  /** Callback when a user is blocked or unblocked */
  onBlockStatusChanged?: () => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = React.memo(({
  roomId,
  currentUserId,
  memberUserIds,
  roomDisplayName,
  roomType,
  memberCount,
  isAnonymous,
  isMobile,
  isSyncing,
  disappearingSettings,
  showSearch,
  showDisappearingMenu,
  onToggleSearch,
  onToggleDisappearingMenu,
  onUpdateDisappearing,
  onLeave,
  onOpenSettings,
  onRoomRenamed,
  onShowMobileMoreMenu,
  showToast,
  blockedUserIds,
  onBlockStatusChanged,
}) => {
  // Inline rename state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Block/unblock state
  const [showBlockConfirm, setShowBlockConfirm] = useState(false);
  const [isBlockBusy, setIsBlockBusy] = useState(false);

  // Contact status for DM header
  const [contactStatus, setContactStatus] = useState<UserStatus>('offline');
  const [contactStatusHovered, setContactStatusHovered] = useState(false);

  // Fetch contact status for DM rooms
  useEffect(() => {
    if (roomType !== 'direct') return;
    const otherUserId = memberUserIds.find((id) => id !== currentUserId);
    if (!otherUserId) return;

    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await getUserStatus(otherUserId);
        if (!cancelled) setContactStatus(res.status);
      } catch {
        // Silently default to offline on error
      }
    };

    void fetchStatus();
    const interval = setInterval(() => void fetchStatus(), 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [roomId, roomType, memberUserIds, currentUserId]);

  const handleStartRename = useCallback(() => {
    setEditNameValue(roomDisplayName || '');
    setIsEditingName(true);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, [roomDisplayName]);

  const handleCancelRename = useCallback(() => {
    setIsEditingName(false);
    setEditNameValue('');
  }, []);

  const handleConfirmRename = useCallback(() => {
    const trimmed = editNameValue.trim();
    if (!trimmed || trimmed === roomDisplayName) {
      handleCancelRename();
      return;
    }
    // Save nickname locally (per-user) instead of updating the server
    try {
      localStorage.setItem(`frame-room-nickname:${roomId}`, trimmed);
    } catch (err) {
      console.error('Failed to save room nickname:', err);
    }
    onRoomRenamed?.(roomId, trimmed);
    setIsEditingName(false);
  }, [editNameValue, roomDisplayName, roomId, onRoomRenamed, handleCancelRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirmRename();
    } else if (e.key === 'Escape') {
      handleCancelRename();
    }
  }, [handleConfirmRename, handleCancelRename]);

  // Derive the other user for DM block/unblock
  const otherUserId = roomType === 'direct'
    ? memberUserIds.find((id) => id !== currentUserId) ?? null
    : null;
  const isOtherBlocked = otherUserId ? (blockedUserIds?.has(otherUserId) ?? false) : false;

  const handleToggleBlock = useCallback(async () => {
    if (!otherUserId) return;
    setIsBlockBusy(true);
    try {
      if (isOtherBlocked) {
        await unblockUser(otherUserId);
        showToast?.('success', 'User unblocked');
      } else {
        await blockUser(otherUserId);
        showToast?.('success', 'User blocked');
      }
      onBlockStatusChanged?.();
    } catch (err) {
      showToast?.('error', err instanceof Error ? err.message : 'Failed to update block status');
    } finally {
      setIsBlockBusy(false);
      setShowBlockConfirm(false);
    }
  }, [otherUserId, isOtherBlocked, showToast, onBlockStatusChanged]);

  const headerName = roomDisplayName
    ? DOMPurify.sanitize(roomDisplayName, PURIFY_CONFIG)
    : DOMPurify.sanitize(roomId, PURIFY_CONFIG);

  return (
    <div style={{ ...styles.header, padding: isMobile ? '6px 8px' : 'clamp(6px, 1vw, 10px) clamp(10px, 1.2vw, 14px)' }}>
      <div style={styles.headerLeft}>
        <div style={styles.headerNameRow}>
          {roomType === 'group' && memberUserIds.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', marginRight: 6, flexShrink: 0 }}>
              {isAnonymous ? (
                <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#6e40aa', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #161b22' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                </div>
              ) : (
                <>
                  {memberUserIds.filter((id) => id !== currentUserId).slice(0, 3).map((userId, idx) => (
                    <div key={userId} title={formatDisplayName(userId)} style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: getAvatarColor(userId), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', border: '2px solid #161b22', marginLeft: idx === 0 ? 0 : -8, zIndex: 3 - idx, position: 'relative' as const }}>
                      {formatDisplayName(userId).charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {memberUserIds.filter((id) => id !== currentUserId).length > 3 && (
                    <div style={{ width: 24, height: 24, borderRadius: '50%', backgroundColor: '#30363d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: '#c9d1d9', border: '2px solid #161b22', marginLeft: -8, zIndex: 0, position: 'relative' as const }}>
                      +{memberUserIds.filter((id) => id !== currentUserId).length - 3}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {isEditingName ? (
            <input ref={renameInputRef} type="text" style={styles.renameInput} value={editNameValue} onChange={(e) => setEditNameValue(e.target.value)} onKeyDown={handleRenameKeyDown} onBlur={handleCancelRename} disabled={isRenaming} maxLength={128} aria-label="Rename room" />
          ) : (
            <span className="frame-chat-header-name" style={{ maxWidth: '50vw', cursor: 'pointer' }} onClick={handleStartRename} title="Click to rename">
              {headerName}
            </span>
          )}
          {/* Subtle E2EE badge */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, marginLeft: 6, opacity: 0.6, flexShrink: 0 }} title="End-to-end encrypted">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span style={{ fontSize: 10, color: '#3fb950', fontWeight: 600 }}>E2EE</span>
          </span>
          {/* Subtle anonymous label */}
          {isAnonymous && (
            <span style={{ fontSize: 10, color: '#bc8cff', opacity: 0.7, marginLeft: 4, fontWeight: 600, flexShrink: 0 }}>Anon</span>
          )}
          {roomType === 'direct' && !isEditingName && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                position: 'relative' as const,
              }}
              onMouseEnter={() => setContactStatusHovered(true)}
              onMouseLeave={() => setContactStatusHovered(false)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: STATUS_COLORS[contactStatus],
                  display: 'inline-block',
                  flexShrink: 0,
                }}
                title={STATUS_LABELS[contactStatus]}
              />
              {contactStatusHovered && (
                <span style={{
                  position: 'absolute' as const,
                  top: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginTop: 4,
                  padding: '3px 8px',
                  fontSize: 11,
                  color: '#c9d1d9',
                  backgroundColor: '#1c2128',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  whiteSpace: 'nowrap' as const,
                  zIndex: 10,
                  pointerEvents: 'none' as const,
                }}>
                  {STATUS_LABELS[contactStatus] /* eslint-disable-line security/detect-object-injection */}
                </span>
              )}
            </span>
          )}
        </div>
        <div style={{ ...styles.headerSubRow, ...(isMobile ? { flexWrap: 'nowrap' as const, overflow: 'hidden', gap: 4 } : {}) }}>
          {/* Small lock icon — indicates E2EE */}
          <span title="End-to-end encrypted" style={{ display: 'inline-flex', flexShrink: 0, opacity: 0.6 }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          </span>
          {disappearingSettings?.enabled && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '1px 5px',
              borderRadius: 4,
              backgroundColor: 'rgba(210, 153, 34, 0.1)',
              color: '#d29922',
              fontSize: 10,
              fontWeight: 600,
            }} title={`Messages auto-delete after ${disappearingSettings.timeoutSeconds < 60 ? String(disappearingSettings.timeoutSeconds) + 's' : disappearingSettings.timeoutSeconds < 3600 ? String(Math.floor(disappearingSettings.timeoutSeconds / 60)) + 'm' : String(Math.floor(disappearingSettings.timeoutSeconds / 3600)) + 'h'}`}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#d29922" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              {disappearingSettings.timeoutSeconds < 60 ? String(disappearingSettings.timeoutSeconds) + 's' : disappearingSettings.timeoutSeconds < 3600 ? String(Math.floor(disappearingSettings.timeoutSeconds / 60)) + 'm' : String(Math.floor(disappearingSettings.timeoutSeconds / 3600)) + 'h'}
            </span>
          )}
          {isSyncing && <SyncIndicator />}
          {memberCount != null && memberCount > 0 && (
            <span style={styles.headerMemberCount}>
              {memberCount} member{memberCount !== 1 ? 's' : ''}
            </span>
          )}
          {roomType === 'direct' && contactStatus !== 'offline' && (
            <span style={{ fontSize: 11, color: '#8b949e' }}>
              {/* eslint-disable-next-line security/detect-object-injection */}
              {'\u00B7'} {STATUS_LABELS[contactStatus]}
            </span>
          )}
          {roomType === 'direct' && contactStatus === 'offline' && (
            <span style={{ fontSize: 11, color: '#6e7681' }}>
              {'\u00B7'} Offline
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 6, position: 'relative' as const }}>
        <button type="button" style={styles.searchButton} title="Search in chat" aria-label="Search in chat" onClick={onToggleSearch}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={showSearch ? '#58a6ff' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </button>
        {!isMobile && <button type="button" style={{ ...styles.disappearingButton, ...(disappearingSettings?.enabled ? styles.disappearingButtonActive : {}) }} title="Disappearing messages" onClick={onToggleDisappearingMenu}>
          {disappearingSettings?.enabled
            ? `Auto-delete \u00B7 ${disappearingSettings.timeoutSeconds < 3600
                ? String(Math.floor(disappearingSettings.timeoutSeconds / 60)) + 'm'
                : disappearingSettings.timeoutSeconds < 86400
                  ? String(Math.floor(disappearingSettings.timeoutSeconds / 3600)) + 'h'
                  : disappearingSettings.timeoutSeconds < 604800
                    ? String(Math.floor(disappearingSettings.timeoutSeconds / 86400)) + 'd'
                    : String(Math.floor(disappearingSettings.timeoutSeconds / 604800)) + 'w'
              }`
            : 'Auto-delete'}
        </button>}
        {showDisappearingMenu && (
          <div style={styles.disappearingMenu}>
            <div style={styles.disappearingMenuTitle}>Disappearing Messages</div>
            {[
              { label: 'Off', seconds: 0 },
              { label: '1 hour', seconds: 3600 },
              { label: '4 hours', seconds: 14400 },
              { label: '8 hours', seconds: 28800 },
              { label: '24 hours', seconds: 86400 },
              { label: '7 days', seconds: 604800 },
            ].map((opt) => (
              <button key={opt.seconds} type="button" style={{ ...styles.disappearingMenuItem, ...(disappearingSettings?.enabled && disappearingSettings.timeoutSeconds === opt.seconds ? { color: '#58a6ff' } : {}), ...(!disappearingSettings?.enabled && opt.seconds === 0 ? { color: '#58a6ff' } : {}) }} onClick={() => onUpdateDisappearing(opt.seconds)}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {!isMobile && onLeave && (
          <button type="button" style={styles.leaveButton} title="Leave conversation" onClick={onLeave}>Leave</button>
        )}
        {!isMobile && roomType === 'direct' && otherUserId && (
          showBlockConfirm ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#f85149', whiteSpace: 'nowrap' as const }}>
                {isOtherBlocked ? 'Unblock?' : 'Block?'}
              </span>
              <button type="button" style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, backgroundColor: isOtherBlocked ? '#238636' : '#da3633', color: '#fff', border: 'none', borderRadius: 4, cursor: isBlockBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: isBlockBusy ? 0.6 : 1 }} disabled={isBlockBusy} onClick={() => void handleToggleBlock()}>
                {isBlockBusy ? '...' : 'Yes'}
              </button>
              <button type="button" style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600, backgroundColor: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => setShowBlockConfirm(false)}>
                No
              </button>
            </div>
          ) : (
            <button
              type="button"
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: isOtherBlocked ? 'rgba(35, 134, 54, 0.1)' : 'rgba(248, 81, 73, 0.1)',
                color: isOtherBlocked ? '#3fb950' : '#f85149',
                border: `1px solid ${isOtherBlocked ? 'rgba(35, 134, 54, 0.4)' : 'rgba(248, 81, 73, 0.4)'}`,
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s',
                flexShrink: 0,
              }}
              title={isOtherBlocked ? 'Unblock this user' : 'Block this user'}
              onClick={() => setShowBlockConfirm(true)}
            >
              {isOtherBlocked ? 'Unblock' : 'Block'}
            </button>
          )
        )}
        {isMobile && (
          <button type="button" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #30363d', backgroundColor: 'transparent', color: '#8b949e', fontSize: 18, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit', flexShrink: 0, minWidth: 44, minHeight: 44 }} title="More options" onClick={onShowMobileMoreMenu} aria-label="More options">
            &#8943;
          </button>
        )}
        {!isMobile && (
          <button type="button" style={styles.infoButton} title="Room info" aria-label="Room info" onClick={() => onOpenSettings?.()}>i</button>
        )}
      </div>
    </div>
  );
});

ChatHeader.displayName = 'ChatHeader';

export default ChatHeader;
