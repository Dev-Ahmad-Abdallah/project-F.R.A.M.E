import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import { sendMessage, deleteMessage, syncMessages, SyncEvent, reactToMessage, markAsRead, getReadReceipts, ReactionData, setTyping, getTypingUsers } from '../api/messagesAPI';
import { listRooms, getRoomMembers } from '../api/roomsAPI';
import type { RoomSummary } from '../api/roomsAPI';
import { formatDisplayName } from '../utils/displayName';
import {
  encryptForRoom,
  decryptEvent,
  processSyncResponse,
  ensureSessionsForRoom,
  DecryptedEvent,
} from '../crypto/sessionManager';
import { checkAndReplenishPrekeys } from '../crypto/olmMachine';
import { useIsMobile } from '../hooks/useIsMobile';
import { SkeletonMessageBubble } from './Skeleton';
import { playMessageSound, playSendSound, playErrorSound, playDestructSound } from '../sounds';
import { getSendReadReceipts, getSendTypingIndicators } from '../utils/privacyPreferences';
import EncryptionVisualizer from './EncryptionVisualizer';
import { generateCodename } from '../utils/codenames';
import { unlockRank } from '../utils/rankSystem';
import { encryptFile } from '../crypto/fileEncryption';
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, FRIENDLY_FILE_TYPES, uploadFile } from '../api/filesAPI';
import { formatFileSize } from '../crypto/fileEncryption';

// ── Extracted modules ──
import { styles } from './chat/chatStyles';
import ChatHeader from './chat/ChatHeader';
import ChatInput from './chat/ChatInput';
import MessageBubble, {
  getAvatarColor,
  formatRelativeTime,
  formatFullTimestamp,
  formatDateSeparator,
  isDifferentDay,
  renderMessageContent,
  CipherTypingIndicator,
} from './chat/MessageBubble';
import {
  isFileMessage,
} from '../utils/messageFormatting';
import { blockUser as blockUserAPI, unblockUser as unblockUserAPI } from '../api/blocksAPI';

// ── Fullscreen Image Viewer ──

function ImageViewer({ src, alt, onClose }: { src: string; alt?: string; onClose: () => void }) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.95)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100000, cursor: 'zoom-out',
      animation: 'frame-fade-in 0.2s ease-out',
    }}>
      <img src={src} alt={alt} onClick={e => e.stopPropagation()} style={{
        maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain',
        borderRadius: 4, cursor: 'default', touchAction: 'pinch-zoom',
      }} />
      <button onClick={onClose} style={{
        position: 'absolute', top: 16, right: 16,
        background: 'rgba(255,255,255,0.1)', border: 'none',
        color: '#fff', fontSize: 24, cursor: 'pointer',
        width: 40, height: 40, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{'\u00D7'}</button>
    </div>
  );
}

// ── Constants ──

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F44F}'];
const GROUP_GAP_MS = 5 * 60 * 1000;
const TIMESTAMP_GAP_MS = 10 * 60 * 1000;

// ── Types ──

type MessageSendStatus = 'sending' | 'sent' | 'failed';

interface OptimisticMessage {
  id: string;
  body: string;
  timestamp: number;
  status: MessageSendStatus;
  viewOnce?: boolean;
}

interface ChatWindowProps {
  roomId: string;
  currentUserId: string;
  memberUserIds: string[];
  roomDisplayName?: string;
  roomType?: 'direct' | 'group';
  memberCount?: number;
  isAnonymous?: boolean;
  onOpenSettings?: () => void;
  onRoomRenamed?: (roomId: string, newName: string) => void;
  onLeave?: () => void;
  showToast?: (type: 'success' | 'error' | 'info' | 'warning', message: string, options?: { persistent?: boolean; dedupeKey?: string; duration?: number }) => void;
  /** Set of user IDs the current user has blocked */
  blockedUserIds?: Set<string>;
  /** Callback when a user is blocked or unblocked */
  onBlockStatusChanged?: () => void;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  roomId, currentUserId, memberUserIds, roomDisplayName, roomType, memberCount, isAnonymous,
  onOpenSettings, onRoomRenamed, onLeave, showToast, blockedUserIds, onBlockStatusChanged,
}) => {
  const isMobile = useIsMobile(600);

  // ── Core state ──
  const [messages, setMessages] = useState<DecryptedEvent[]>([]);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [showRoomSkeleton, setShowRoomSkeleton] = useState(true);
  const [e2eeAnimDone, setE2eeAnimDone] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [contextMenuEventId, setContextMenuEventId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [deletedEventIds, setDeletedEventIds] = useState<Set<string>>(new Set());
  const [viewOnceMode, setViewOnceMode] = useState(false);
  const [viewedOnceIds, setViewedOnceIds] = useState<Set<string>>(() => { try { const s = localStorage.getItem('frame-viewed-once'); return s ? new Set(JSON.parse(s) as string[]) : new Set(); } catch { return new Set(); } });
  const [hiddenOnceIds, setHiddenOnceIds] = useState<Set<string>>(() => { try { const s = localStorage.getItem('frame-hidden-once'); return s ? new Set(JSON.parse(s) as string[]) : new Set(); } catch { return new Set(); } });
  const [_consumedOnceIds, setConsumedOnceIds] = useState<Set<string>>(() => { try { const s = localStorage.getItem('frame-consumed-once'); return s ? new Set(JSON.parse(s) as string[]) : new Set(); } catch { return new Set(); } });
  const [expiredEventIds, setExpiredEventIds] = useState<Set<string>>(new Set());
  const [selfDestructingIds, setSelfDestructingIds] = useState<Set<string>>(new Set());
  const [destroyedIds, setDestroyedIds] = useState<Set<string>>(new Set());
  const [showDestructFlash, setShowDestructFlash] = useState(false);
  const [disappearingSettings, setDisappearingSettings] = useState<{ enabled: boolean; timeoutSeconds: number } | null>(null);
  const [showDisappearingMenu, setShowDisappearingMenu] = useState(false);
  const [reactionPickerEventId, setReactionPickerEventId] = useState<string | null>(null);
  const [reactionPickerPos, setReactionPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [localReactions, setLocalReactions] = useState<Record<string, Record<string, ReactionData>>>({});
  const [readEventIds, setReadEventIds] = useState<Set<string>>(new Set());
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const [readByUsers, setReadByUsers] = useState<Record<string, string[]>>({});
  /* eslint-enable @typescript-eslint/no-unused-vars */
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const isNearBottomRef = useRef(true);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const [readReceiptMap, setReadReceiptMap] = useState<Record<string, { readAt: string }>>({});
  const [forwardEventId, setForwardEventId] = useState<string | null>(null);
  const [forwardRooms, setForwardRooms] = useState<RoomSummary[]>([]);
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pinnedEventIds, setPinnedEventIds] = useState<string[]>([]);
  const [showPinnedBar, setShowPinnedBar] = useState(true);
  const [viewerImage, setViewerImage] = useState<{ src: string; alt?: string } | null>(null);
  const [unreadDividerEventId, setUnreadDividerEventId] = useState<string | null>(null);
  const hasSetUnreadDividerRef = useRef(false);
  const lastClickTimeRef = useRef<Record<string, number>>({});
  const [replyTo, setReplyTo] = useState<{ eventId: string; senderId: string; body: string } | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl: string | null } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [recentlySentIds, setRecentlySentIds] = useState<Set<string>>(new Set());
  const [recentlyArrivedIds, setRecentlyArrivedIds] = useState<Set<string>>(new Set());
  const [showMobileMoreMenu, setShowMobileMoreMenu] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const nextBatchRef = useRef<string | undefined>(undefined);
  const syncGenRef = useRef(0);
  const syncBackoffRef = useRef(1000);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setE2eeAnimDone(false); }, [roomId]);
  const [, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(i); }, []);

  // Ctrl+F search shortcut
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setShowSearch(true); setSearchMatchIndex(0); setTimeout(() => searchInputRef.current?.focus(), 0); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  // Inject animation keyframes
  useEffect(() => {
    const styleId = 'frame-typing-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style'); style.id = styleId;
      style.textContent = `@keyframes frame-typing-bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}textarea::placeholder{color:#8b949e}@keyframes frame-cursor-blink{0%,100%{opacity:1}50%{opacity:0}}@keyframes frame-msg-slide-up{0%{opacity:0;transform:translateY(20px)}100%{opacity:1;transform:translateY(0)}}@keyframes frame-msg-pop-in{0%{opacity:0;transform:scale(.95)}60%{opacity:1;transform:scale(1.01)}100%{opacity:1;transform:scale(1)}}@keyframes frame-send-launch{0%{transform:scale(1)}30%{transform:scale(.88)}60%{transform:scale(1.08)}100%{transform:scale(1)}}@keyframes frame-lock-pulse{0%{transform:scale(1);opacity:1}25%{transform:scale(1.4);opacity:.6;color:#3fb950}50%{transform:scale(.9);opacity:1}75%{transform:scale(1.15);opacity:.8;color:#3fb950}100%{transform:scale(1);opacity:1}}@keyframes frame-welcome-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}@keyframes frame-context-menu-in{0%{opacity:0;transform:scale(.92)}100%{opacity:1;transform:scale(1)}}@keyframes frame-spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}.frame-context-menu-item:hover{background-color:rgba(248,81,73,.15)!important}.frame-msg-row:hover>.frame-msg-hover-actions{opacity:1!important}.frame-msg-hover-action:hover{color:#c9d1d9!important;background-color:rgba(139,148,158,.12)!important}@media(hover:none),(max-width:600px){.frame-msg-hover-actions{display:none!important}}.frame-reaction-emoji:hover{background-color:rgba(88,166,255,.15)!important;transform:scale(1.2)!important}.frame-reaction-badge:hover{border-color:#58a6ff!important}.frame-msg-text-own a:hover,.frame-msg-text a:hover{opacity:.8!important}.frame-msg-text-own a{color:rgba(255,255,255,.95)!important;text-decoration:underline!important}.frame-msg-text a{color:#58a6ff!important;text-decoration:underline!important}@keyframes frame-bottom-sheet-slide-up{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes frame-overlay-fade-in{from{opacity:0}to{opacity:1}}@keyframes frame-defcon-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}`;
      document.head.appendChild(style);
    }
  }, []);

  // Session establishment
  useEffect(() => { if (!roomId || memberUserIds.length === 0) return; let c = false; void (async () => { try { await ensureSessionsForRoom(roomId, memberUserIds); } catch (e) { if (!c) console.warn('[F.R.A.M.E.] Session init failed:', e); } })(); return () => { c = true; }; }, [roomId, memberUserIds]);

  // Read receipts
  useEffect(() => { let c = false; const f = async () => { try { const { receipts } = await getReadReceipts(roomId); if (!c && receipts?.length > 0) { const m: Record<string, { readAt: string }> = {}; for (const r of receipts) m[r.event_id] = { readAt: r.read_at }; setReadReceiptMap(m); } } catch { /* non-critical */ } }; void f(); const i = setInterval(() => void f(), 15000); return () => { c = true; clearInterval(i); }; }, [roomId]);

  // Room settings
  useEffect(() => { let c = false; void (async () => { try { const { getRoomSettingsAPI } = await import('../api/roomsAPI'); const r = await getRoomSettingsAPI(roomId); if (!c) { if (r.settings?.disappearingMessages) setDisappearingSettings(r.settings.disappearingMessages as { enabled: boolean; timeoutSeconds: number }); if (r.settings?.pinnedEventIds && Array.isArray(r.settings.pinnedEventIds)) setPinnedEventIds(r.settings.pinnedEventIds as string[]); } } catch { /* settings not available */ } })(); return () => { c = true; }; }, [roomId]);

  // Expire messages
  useEffect(() => {
    if (!disappearingSettings?.enabled) return;
    const check = () => { const now = Date.now(); const ms = disappearingSettings.timeoutSeconds * 1000; const ne = new Set(expiredEventIds); const nd = new Set(selfDestructingIds); let ch = false, dc = false;
      for (const m of messages) { const t = new Date(m.event.originServerTs).getTime(); if (now - t > ms && !ne.has(m.event.eventId) && !nd.has(m.event.eventId)) { nd.add(m.event.eventId); dc = true; playDestructSound(); setTimeout(() => { setShowDestructFlash(true); setTimeout(() => setShowDestructFlash(false), 100); setSelfDestructingIds(p => { const n = new Set(p); n.delete(m.event.eventId); return n; }); setDestroyedIds(p => new Set(p).add(m.event.eventId)); setTimeout(() => { setDestroyedIds(p => { const n = new Set(p); n.delete(m.event.eventId); return n; }); setExpiredEventIds(p => new Set(p).add(m.event.eventId)); }, 2000); }, 800); } }
      if (dc) setSelfDestructingIds(nd);
      for (const m of messages) { const t = new Date(m.event.originServerTs).getTime(); if (now - t > ms + 3000 && !ne.has(m.event.eventId)) { ne.add(m.event.eventId); ch = true; } }
      if (ch) setExpiredEventIds(ne); };
    check(); const t = setInterval(check, 1000); return () => clearInterval(t);
  }, [disappearingSettings, messages, expiredEventIds, selfDestructingIds]);

  // View-once
  const viewOnceTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => { for (const t of Object.values(viewOnceTimersRef.current)) clearTimeout(t); }, []);
  const getViewOnceType = useCallback((pt: Record<string, unknown>): string => { const m = pt?.msgtype as string; if (m === 'm.audio') return '\uD83C\uDFA4 Voice message'; if (m === 'm.image') return '\uD83D\uDCF7 Photo'; if (m === 'm.file') return `\uD83D\uDCCE ${(pt.filename as string) || 'File'}`; return '\uD83D\uDCAC Message'; }, []);
  const getViewOnceDuration = useCallback((pt: Record<string, unknown>): number => { const m = pt?.msgtype as string; if (m === 'm.audio') return ((pt.duration as number) || 5000) + 3000; if (m === 'm.image') return 30000; if (m === 'm.file') return 10000; return 5000; }, []);
  const revealViewOnce = useCallback((eid: string, pt: Record<string, unknown>) => {
    setViewedOnceIds(p => { const n = new Set(p); n.add(eid); try { localStorage.setItem('frame-viewed-once', JSON.stringify([...n])); } catch { /* ignore */ } return n; });
    const dur = getViewOnceDuration(pt);
    // eslint-disable-next-line security/detect-object-injection
    const timer = setTimeout(() => { setHiddenOnceIds(p => { const n = new Set(p); n.add(eid); try { localStorage.setItem('frame-hidden-once', JSON.stringify([...n])); } catch { /* ignore */ } return n; }); setMessages(p => p.map(m => m.event.eventId === eid ? { ...m, plaintext: null, decryptionError: 'View-once message already viewed' } : m)); deleteMessage(eid).catch(e => console.error('[ViewOnce] Delete failed:', e)); delete viewOnceTimersRef.current[eid]; }, dur);
    // eslint-disable-next-line security/detect-object-injection
    viewOnceTimersRef.current[eid] = timer;
  }, [getViewOnceDuration]);

  // Scroll
  const handleScroll = useCallback(() => { const el = messageListRef.current; if (!el) return; isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (isNearBottomRef.current) setShowNewMessagesPill(false); }, []);
  useEffect(() => { if (isNearBottomRef.current) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); else if (messages.length > 0) setShowNewMessagesPill(true); }, [messages, optimisticMessages]);
  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowNewMessagesPill(false); }, []);
  // eslint-disable-next-line security/detect-object-injection
  const scrollToMessage = useCallback((eid: string) => { const el = messageRefs.current[eid]; if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.style.transition = 'background-color 0.3s'; el.style.backgroundColor = 'rgba(88,166,255,0.15)'; setTimeout(() => { el.style.backgroundColor = ''; }, 1200); } }, []);

  // Sync
  const decryptEvents = useCallback(async (events: SyncEvent[]): Promise<DecryptedEvent[]> => { const r: DecryptedEvent[] = []; for (const e of events) r.push(await decryptEvent(e)); return r; }, []);
  const syncLoop = useCallback(async (gen: number) => {
    while (syncGenRef.current === gen) {
      try {
        const result = await syncMessages(nextBatchRef.current, 10000, 50); if (syncGenRef.current !== gen) break;
        if (result.events.length > 0) { setIsSyncing(true); setTimeout(() => setIsSyncing(false), 600); }
        await processSyncResponse(result); nextBatchRef.current = result.nextBatch;
        // After processing to-device messages (which may contain Megolm session keys),
        // retry decryption of any previously failed messages so "Unable to decrypt" resolves.
        if (result.to_device && result.to_device.length > 0) {
          setMessages(prev => {
            const failed = prev.filter(m => m.decryptionError !== null);
            if (failed.length === 0) return prev;
            // Re-attempt decryption asynchronously and update state when done
            void (async () => {
              const updated: Map<string, DecryptedEvent> = new Map();
              for (const m of failed) {
                try {
                  const retried = await decryptEvent(m.event);
                  if (!retried.decryptionError) {
                    updated.set(m.event.eventId, retried);
                  }
                } catch { /* keep original on error */ }
              }
              if (updated.size > 0) {
                setMessages(p => p.map(m => updated.get(m.event.eventId) ?? m));
              }
            })();
            return prev;
          });
        }
        if (result.events.length > 0) {
          const re = result.events.filter(e => e.roomId === roomId); const de = re.length > 0 ? await decryptEvents(re) : [];
          if (syncGenRef.current !== gen) break;
          if (de.length > 0) {
            const hasOther = de.some(e => e.event.senderId !== currentUserId);
            if (!hasSetUnreadDividerRef.current) { const f = de.find(e => e.event.senderId !== currentUserId); if (f) { setUnreadDividerEventId(f.event.eventId); hasSetUnreadDividerRef.current = true; } }
            if (hasOther) playMessageSound();
            setMessages(p => [...p, ...de]);
            const ids = de.map(e => e.event.eventId);
            setRecentlyArrivedIds(p => { const n = new Set(p); ids.forEach(id => n.add(id)); return n; });
            setTimeout(() => setRecentlyArrivedIds(p => { const n = new Set(p); ids.forEach(id => n.delete(id)); return n; }), 400);
          }
          setOptimisticMessages(p => p.filter(o => o.status === 'failed'));
        }
        setSyncError(null); syncBackoffRef.current = 1000;
        // Check OTK count after each successful sync and replenish if low
        void checkAndReplenishPrekeys();
      } catch { if (syncGenRef.current !== gen) break; setSyncError('reconnecting'); const d = syncBackoffRef.current; syncBackoffRef.current = Math.min(d * 2, 30000); await new Promise(r => setTimeout(r, d)); }
    }
  }, [decryptEvents, roomId, currentUserId]);

  useEffect(() => { setShowRoomSkeleton(true); const t = setTimeout(() => setShowRoomSkeleton(false), 200); return () => clearTimeout(t); }, [roomId]);
  useEffect(() => { if (messages.length > 0 && showRoomSkeleton) setShowRoomSkeleton(false); }, [messages.length, showRoomSkeleton]);

  useEffect(() => {
    setMessages([]); setOptimisticMessages([]); nextBatchRef.current = undefined; syncBackoffRef.current = 1000; setShowSearch(false); setSearchQuery(''); setPinnedEventIds([]); setShowPinnedBar(true); setUnreadDividerEventId(null); hasSetUnreadDividerRef.current = false;
    const gen = ++syncGenRef.current; const timer = setTimeout(() => void syncLoop(gen), 0);
    const vis = () => { if (document.visibilityState === 'visible' && syncGenRef.current === gen) { syncBackoffRef.current = 1000; void syncLoop(++syncGenRef.current); } };
    document.addEventListener('visibilitychange', vis);
    const online = () => { if (syncGenRef.current === gen) { syncBackoffRef.current = 1000; void syncLoop(++syncGenRef.current); } };
    window.addEventListener('online', online);
    return () => { ++syncGenRef.current; clearTimeout(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', online); };
  }, [roomId, syncLoop]);

  // Handlers
  const handleCopyText = useCallback((eid: string) => { setContextMenuEventId(null); setContextMenuPos(null); const m = messages.find(m => m.event.eventId === eid); if (!m) return; const b = m.plaintext && typeof m.plaintext.body === 'string' ? m.plaintext.body : renderMessageContent(m); navigator.clipboard.writeText(b).then(() => showToast?.('success', 'Message copied')).catch(() => showToast?.('error', 'Copy failed')); }, [messages, showToast]);

  const handleTogglePin = useCallback(async (eid: string) => { setContextMenuEventId(null); setContextMenuPos(null); const isPinned = pinnedEventIds.includes(eid); const np = isPinned ? pinnedEventIds.filter(id => id !== eid) : [...pinnedEventIds, eid]; setPinnedEventIds(np); try { const { updateRoomSettings } = await import('../api/roomsAPI'); await updateRoomSettings(roomId, { pinnedEventIds: np }); showToast?.('success', isPinned ? 'Unpinned' : 'Pinned'); } catch { setPinnedEventIds(pinnedEventIds); showToast?.('error', 'Failed to update pins'); } }, [pinnedEventIds, roomId, showToast]);

  const handleReactRef = useRef<((eid: string, emoji: string) => Promise<void>) | null>(null);
  const handleReplyToMessage = useCallback((eid: string) => { setContextMenuEventId(null); setContextMenuPos(null); const m = messages.find(m => m.event.eventId === eid); if (!m) return; setReplyTo({ eventId: eid, senderId: m.event.senderId, body: m.plaintext && typeof m.plaintext.body === 'string' ? m.plaintext.body : 'Message' }); setTimeout(() => textareaRef.current?.focus(), 0); }, [messages]);
  const handleCancelReply = useCallback(() => setReplyTo(null), []);

  const handleSend = async (retryText?: string) => {
    const text = retryText || inputValue.trim(); if (!text || isSending) return;
    if (text.length > 5000) { showToast?.('error', 'Message too long (max 5000 characters)', { duration: 4000, dedupeKey: 'msg-too-long' }); return; }
    const isVO = viewOnceMode; const cr = replyTo;
    const oid = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setOptimisticMessages(p => [...p, { id: oid, body: text, timestamp: Date.now(), status: 'sending', viewOnce: isVO }]);
    setRecentlySentIds(p => new Set(p).add(oid)); setTimeout(() => setRecentlySentIds(p => { const n = new Set(p); n.delete(oid); return n; }), 400);
    if (!retryText) { setInputValue(''); setViewOnceMode(false); setReplyTo(null); if (textareaRef.current) textareaRef.current.style.height = 'auto'; }
    setIsSending(true);
    try {
      const pt: Record<string, unknown> = { msgtype: 'm.text', body: text };
      if (isVO) pt.viewOnce = true;
      if (cr) pt.replyTo = { eventId: cr.eventId, senderId: cr.senderId, body: cr.body.length > 100 ? cr.body.slice(0, 100) + '...' : cr.body };
      const enc = await encryptForRoom(roomId, 'm.room.message', pt, memberUserIds);
      await sendMessage(roomId, 'm.room.encrypted', enc); playSendSound(); unlockRank('recruit');
      setOptimisticMessages(p => p.map(o => o.id === oid ? { ...o, status: 'sent' as const } : o));
    } catch (err) { console.error('Send failed:', err); playErrorSound(); setOptimisticMessages(p => p.map(o => o.id === oid ? { ...o, status: 'failed' as const } : o)); showToast?.('error', 'Failed to send. Tap to retry.', { dedupeKey: 'send-fail', duration: 4000 }); }
    finally { setIsSending(false); }
  };

  const handleVoiceSend = useCallback(async (audio: string, dur: number, mime?: string) => {
    setIsRecordingVoice(false); if (!roomId) return;
    try { const vc: Record<string, unknown> = { msgtype: 'm.audio', body: 'Voice message', audioData: audio, duration: dur }; if (mime) vc.audioMimeType = mime; if (viewOnceMode) vc.viewOnce = true; const enc = await encryptForRoom(roomId, 'm.room.message', vc, memberUserIds); await sendMessage(roomId, 'm.room.encrypted', enc); playSendSound(); }
    catch (err) { console.error('[Voice] Failed:', err); playErrorSound(); showToast?.('error', 'Voice send failed', { duration: 4000, dedupeKey: 'voice-fail' }); }
  }, [roomId, memberUserIds, showToast, viewOnceMode]);

  // File attachment
  const stageFile = useCallback((file: File) => { if (!ALLOWED_FILE_TYPES.has(file.type)) { showToast?.('error', `File type not allowed. Supported: ${FRIENDLY_FILE_TYPES}`, { duration: 5000 }); return; } if (file.size > MAX_FILE_SIZE) { showToast?.('error', 'File too large. Max 10 MB.', { duration: 4000 }); return; } if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl); setPendingFile({ file, previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }); }, [showToast, pendingFile]);
  const cancelPendingFile = useCallback(() => { if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl); setPendingFile(null); }, [pendingFile]);
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if ((e.target as HTMLInputElement).value) (e.target as HTMLInputElement).value = ''; if (f) stageFile(f); }, [stageFile]);

  const handleSendFile = useCallback(async () => {
    if (!pendingFile || !roomId || isUploadingFile) return; const f = pendingFile.file; setIsUploadingFile(true); setUploadStatus('Encrypting...');
    try { const ab = await f.arrayBuffer(); const { encryptedBytes, key: fk, iv: fi } = await encryptFile(new Uint8Array(ab)); setUploadStatus(`Uploading (${formatFileSize(f.size)})...`); const ur = await uploadFile(encryptedBytes, roomId, f.name, f.type || 'application/octet-stream'); setUploadStatus('Securing...'); const pt: Record<string, unknown> = { msgtype: f.type.startsWith('image/') ? 'm.image' : 'm.file', body: f.name, filename: f.name, fileId: ur.fileId, fileKey: fk, fileIv: fi, mimeType: f.type || 'application/octet-stream', fileSize: f.size }; if (viewOnceMode) pt.viewOnce = true; const enc = await encryptForRoom(roomId, 'm.room.message', pt, memberUserIds); await sendMessage(roomId, 'm.room.encrypted', enc); if (pendingFile.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl); setPendingFile(null); playSendSound(); showToast?.('success', 'File sent securely', { duration: 2000 }); }
    catch (err) { console.error('[File] Failed:', err); playErrorSound(); showToast?.('error', `File send failed: ${err instanceof Error ? err.message : 'error'}`, { duration: 5000, dedupeKey: 'file-fail' }); }
    finally { setIsUploadingFile(false); setUploadStatus(null); }
  }, [pendingFile, roomId, isUploadingFile, memberUserIds, showToast, viewOnceMode]);

  const handleCameraCapture = useCallback(async (file: File) => {
    setShowCamera(false); setCameraStream(null); setIsUploadingFile(true); setUploadStatus('Encrypting...');
    try { const { encryptedBytes, key: fk, iv: fi } = await encryptFile(new Uint8Array(await file.arrayBuffer())); setUploadStatus(`Uploading (${formatFileSize(file.size)})...`); const ur = await uploadFile(encryptedBytes, roomId, file.name, file.type || 'image/jpeg'); setUploadStatus('Securing...'); const pt: Record<string, unknown> = { msgtype: 'm.image', body: file.name, filename: file.name, fileId: ur.fileId, fileKey: fk, fileIv: fi, mimeType: file.type || 'image/jpeg', fileSize: file.size }; if (viewOnceMode) pt.viewOnce = true; const enc = await encryptForRoom(roomId, 'm.room.message', pt, memberUserIds); await sendMessage(roomId, 'm.room.encrypted', enc); playSendSound(); if (viewOnceMode) setViewOnceMode(false); showToast?.('success', 'Photo sent securely', { duration: 2000 }); }
    catch (err) { console.error('[Camera] Failed:', err); playErrorSound(); showToast?.('error', `Photo send failed`, { duration: 5000, dedupeKey: 'camera-fail' }); }
    finally { setIsUploadingFile(false); setUploadStatus(null); }
  }, [roomId, memberUserIds, showToast, viewOnceMode]);

  // Paste and drag-drop
  // eslint-disable-next-line security/detect-object-injection
  useEffect(() => { const h = (e: ClipboardEvent) => { if (!e.clipboardData || e.defaultPrevented) return; for (let i = 0; i < e.clipboardData.items.length; i++) { const it = e.clipboardData.items[i]; if (it.kind === 'file' && it.type.startsWith('image/')) { e.preventDefault(); const f = it.getAsFile(); if (f) stageFile(new File([f], `pasted-${Date.now()}.${f.type.split('/')[1] || 'png'}`, { type: f.type })); return; } } }; document.addEventListener('paste', h); return () => document.removeEventListener('paste', h); }, [stageFile]);
  const handleDragEnter = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current++; if (e.dataTransfer.types.includes('Files')) setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (--dragCounterRef.current === 0) setIsDragOver(false); }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current = 0; setIsDragOver(false); if (e.dataTransfer.files.length > 0) stageFile(e.dataTransfer.files[0]); }, [stageFile]);

  const handleRetry = (om: OptimisticMessage) => { setOptimisticMessages(p => p.filter(m => m.id !== om.id)); void handleSend(om.body); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (pendingFile) void handleSendFile(); else void handleSend(); } };
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => { setInputValue(e.target.value); const ta = e.target; ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 116)}px`; if (getSendTypingIndicators()) { const now = Date.now(); if (e.target.value.trim() && now - lastTypingSentRef.current > 3000) { lastTypingSentRef.current = now; setTyping(roomId, true).catch(() => undefined); } if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); if (e.target.value.trim()) typingTimeoutRef.current = setTimeout(() => { void setTyping(roomId, false).catch(() => undefined); }, 3000); else void setTyping(roomId, false).catch(() => undefined); } };

  // Typing polling
  useEffect(() => { const p = async () => { try { const r = await getTypingUsers(roomId); setTypingUsers(r.typingUserIds); } catch { /* ignore */ } }; void p(); const i = setInterval(() => void p(), 2000); return () => { clearInterval(i); setTypingUsers([]); }; }, [roomId]);
  useEffect(() => () => { if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current); if (typingIntervalRef.current) clearInterval(typingIntervalRef.current); if (getSendTypingIndicators()) setTyping(roomId, false).catch(() => undefined); }, [roomId]);

  // Forwarding
  const handleForwardMessage = useCallback(async (eid: string) => { setContextMenuEventId(null); setContextMenuPos(null); setForwardEventId(eid); try { const rooms = await listRooms(); setForwardRooms(rooms.filter(r => r.roomId !== roomId)); setShowForwardDialog(true); } catch (e) { console.error('Forward load failed:', e); showToast?.('error', 'Could not load rooms for forwarding', { duration: 3000, dedupeKey: 'forward-fail' }); } }, [roomId]);
  const handleForwardToRoom = useCallback(async (tid: string, tn: string) => { if (!forwardEventId) return; const m = messages.find(m => m.event.eventId === forwardEventId); if (!m?.plaintext) return; const body = typeof m.plaintext.body === 'string' ? m.plaintext.body : JSON.stringify(m.plaintext); const isFile = isFileMessage(m.plaintext); const forwardedContent = isFile ? { ...m.plaintext, forwarded: true } : { msgtype: 'm.text', body, forwarded: true }; try { const tm = await getRoomMembers(tid); const enc = await encryptForRoom(tid, 'm.room.message', forwardedContent, tm.map(m => m.userId)); await sendMessage(tid, 'm.room.encrypted', enc); showToast?.('success', `Forwarded to ${tn}`); } catch { showToast?.('error', 'Forward failed'); } setShowForwardDialog(false); setForwardEventId(null); }, [forwardEventId, messages, showToast]);

  // Reactions
  const handleShowReactionPicker = (e: React.MouseEvent, eid: string) => { e.preventDefault(); e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setReactionPickerEventId(eid); setReactionPickerPos({ x: r.left, y: r.top - 44 }); };
  const handleReact = async (eid: string, emoji: string) => { setReactionPickerEventId(null); setReactionPickerPos(null); try { const r = await reactToMessage(eid, emoji); setLocalReactions(p => ({ ...p, [eid]: r.reactions })); } catch (e) { console.error('React failed:', e); showToast?.('error', 'Reaction failed', { duration: 2000, dedupeKey: 'react-fail' }); } };
  handleReactRef.current = handleReact;
  // eslint-disable-next-line security/detect-object-injection
  const handleMessageClick = useCallback((e: React.MouseEvent, eid: string) => { const now = Date.now(); const last = lastClickTimeRef.current[eid] || 0; if (now - last < 350) { void handleReactRef.current?.(eid, '\u2764\uFE0F'); lastClickTimeRef.current[eid] = 0; } else lastClickTimeRef.current[eid] = now; }, []);

  // Long-press
  const handleTouchStart = useCallback((eid: string, _sid: string) => { longPressTriggeredRef.current = false; longPressTimerRef.current = setTimeout(() => { longPressTriggeredRef.current = true; if (!deletedEventIds.has(eid)) { setContextMenuEventId(eid); setContextMenuPos({ x: 0, y: 0 }); } }, 500); }, [deletedEventIds]);
  const handleTouchEnd = useCallback(() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }, []);
  const handleTouchMove = useCallback(() => { if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; } }, []);

  // Read receipts send
  useEffect(() => { if (messages.length === 0) return; const lo = [...messages].reverse().find(m => m.event.senderId !== currentUserId); if (lo && !readEventIds.has(lo.event.eventId)) { setReadEventIds(p => new Set(p).add(lo.event.eventId)); if (getSendReadReceipts()) markAsRead(lo.event.eventId).catch(e => console.error('Read receipt failed:', e)); } }, [messages, currentUserId, readEventIds]);

  // Close menus
  useEffect(() => { const h = () => { setContextMenuEventId(null); setContextMenuPos(null); setShowDisappearingMenu(false); setReactionPickerEventId(null); setReactionPickerPos(null); }; if (contextMenuEventId || showDisappearingMenu || reactionPickerEventId) { window.addEventListener('click', h); return () => window.removeEventListener('click', h); } }, [contextMenuEventId, showDisappearingMenu, reactionPickerEventId]);

  const handleMessageContextMenu = (e: React.MouseEvent, eid: string, _sid: string) => { if (deletedEventIds.has(eid)) return; e.preventDefault(); setContextMenuEventId(eid); setContextMenuPos({ x: e.clientX, y: e.clientY }); };
  const handleDeleteMessage = async (eid: string) => { setContextMenuEventId(null); setContextMenuPos(null); try { await deleteMessage(eid); setDeletedEventIds(p => new Set(p).add(eid)); } catch (e) { console.error('Delete failed:', e); showToast?.('error', 'Failed to delete message', { duration: 3000, dedupeKey: 'delete-fail' }); } };

  const headerName = roomDisplayName ? DOMPurify.sanitize(roomDisplayName, PURIFY_CONFIG) : DOMPurify.sanitize(roomId, PURIFY_CONFIG);
  const resolveDisplayName = useCallback((sid: string, sdn?: string): string => isAnonymous ? generateCodename(sid + roomId) : sdn || formatDisplayName(sid), [isAnonymous, roomId]);

  const filteredMessages = useMemo(() => { if (!searchQuery.trim()) return messages; const q = searchQuery.toLowerCase(); return messages.filter(m => m.plaintext && typeof m.plaintext.body === 'string' && m.plaintext.body.toLowerCase().includes(q)); }, [messages, searchQuery]);
  // eslint-disable-next-line security/detect-object-injection
  useEffect(() => { if (!searchQuery.trim() || filteredMessages.length === 0) return; const idx = Math.min(searchMatchIndex, filteredMessages.length - 1); const t = filteredMessages[idx]; if (t) messageRefs.current[t.event.eventId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [searchMatchIndex, searchQuery, filteredMessages]);

  const handleConsumedOnce = useCallback((eid: string) => { setConsumedOnceIds(p => { const n = new Set(p); n.add(eid); try { localStorage.setItem('frame-consumed-once', JSON.stringify([...n])); } catch { /* ignore */ } return n; }); }, []);

  const handleImageClick = useCallback((src: string, alt?: string) => { setViewerImage({ src, alt }); }, []);

  // Rendered messages
  const renderedMessages = useMemo(() => {
    const src = searchQuery.trim() ? filteredMessages : messages; const els: React.ReactNode[] = [];
    let lastSid: string | null = null, lastTs: Date | null = null, lastDt: Date | null = null;
    const runStarts = new Set<number>(); const runLens: Record<number, number> = {}; const skip = new Set<number>();
    // eslint-disable-next-line security/detect-object-injection
    { let rs = -1, rc = 0; for (let j = 0; j <= src.length; j++) { const m = j < src.length ? src[j] : null; const und = m !== null && m.decryptionError !== null && !deletedEventIds.has(m.event.eventId) && !expiredEventIds.has(m.event.eventId); if (und) { if (rs === -1) { rs = j; rc = 1; } else rc++; } else { if (rs !== -1 && rc > 1) { runStarts.add(rs); runLens[rs] = rc; for (let k = rs + 1; k < rs + rc; k++) skip.add(k); } rs = -1; rc = 0; } } }

    for (const [i, dec] of src.entries()) {
      if (skip.has(i)) { lastSid = dec.event.senderId; lastTs = new Date(dec.event.originServerTs); lastDt = lastTs; continue; }
      const ev = dec.event, isOwn = ev.senderId === currentUserId, hasErr = dec.decryptionError !== null;
      const md = new Date(ev.originServerTs), isDel = deletedEventIds.has(ev.eventId), isExp = expiredEventIds.has(ev.eventId);
      const isSD = selfDestructingIds.has(ev.eventId), isDest = destroyedIds.has(ev.eventId);
      const isVO = dec.plaintext && dec.plaintext.viewOnce === true, isHO = hiddenOnceIds.has(ev.eventId);
      // eslint-disable-next-line security/detect-object-injection
      const cc = runStarts.has(i) ? runLens[i] : 0;

      if (isDest) { els.push(<div key={ev.eventId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', alignSelf: isOwn ? 'flex-end' : 'flex-start', padding: '8px 16px', marginTop: 4, animation: 'frame-destruct-text-fade 2s ease-out forwards' }}><span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#f85149', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>{'\u{1F4A3}'} MESSAGE DESTROYED</span></div>); lastSid = ev.senderId; lastTs = md; lastDt = md; continue; }
      if (!lastDt || isDifferentDay(lastDt, md)) els.push(<div key={`d-${ev.eventId}`} style={styles.dateSeparator}><div style={styles.dateSeparatorLine} /><span className="frame-date-sep-text" style={{ ...styles.dateSeparatorText, ...(isMobile ? { fontSize: 10 } : {}) }}>{formatDateSeparator(md)}</span><div style={styles.dateSeparatorLine} /></div>);
      if (unreadDividerEventId && ev.eventId === unreadDividerEventId && !searchQuery.trim()) els.push(<div key="unread-divider" style={styles.unreadDivider}><div style={styles.unreadDividerLine} /><span style={styles.unreadDividerText}>New messages</span><div style={styles.unreadDividerLine} /></div>);

      const gap = lastTs ? md.getTime() - lastTs.getTime() : Infinity;
      const isNG = lastSid !== ev.senderId || gap > GROUP_GAP_MS;
      if (lastTs && gap > TIMESTAMP_GAP_MS && lastDt && !isDifferentDay(lastDt, md)) els.push(<div key={`g-${ev.eventId}`} style={styles.timeGap}><span style={styles.timeGapText}>{formatRelativeTime(md)}</span></div>);

      if (isVO && isHO && !isOwn) { els.push(<div key={ev.eventId} style={{ ...styles.messageBubble, maxWidth: isMobile ? '75%' : 'clamp(200px,65%,480px)', ...styles.otherMessage, opacity: 0.5, alignSelf: 'flex-start' as const }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#484f58', fontStyle: 'italic', fontSize: 12, padding: '8px 12px' }}><span>{'\uD83D\uDD12'}</span><span>Opened</span></div></div>); lastSid = ev.senderId; lastTs = md; lastDt = md; continue; }

      if (isVO && !isOwn && !viewedOnceIds.has(ev.eventId) && !isHO && dec.plaintext) {
        const vt = getViewOnceType(dec.plaintext), vp = dec.plaintext;
        els.push(<div key={ev.eventId} ref={el => { messageRefs.current[ev.eventId] = el; }} className="frame-msg-row" style={{ display: 'flex', alignItems: 'flex-end', gap: 8, alignSelf: 'flex-start', maxWidth: isMobile ? '75%' : 'clamp(200px,65%,480px)', marginTop: isNG ? 8 : 2, position: 'relative' as const, overflow: 'hidden' as const }}>{!isOwn && <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: isNG ? (isAnonymous ? '#6e40aa' : getAvatarColor(ev.senderId)) : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, color: '#fff', flexShrink: 0, visibility: isNG ? 'visible' as const : 'hidden' as const }}>{isNG ? (isAnonymous ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /><line x1="2" y1="2" x2="22" y2="22" /></svg> : formatDisplayName(ev.senderId).charAt(0).toUpperCase()) : ''}</div>}<div className="frame-msg-bubble" style={{ ...styles.messageBubble, ...(isMobile ? { padding: '10px 14px' } : {}), ...styles.otherMessage, borderRadius: 16, marginTop: 0, maxWidth: '100%' }}>{!isOwn && isNG && <div style={{ ...styles.senderName, color: isAnonymous ? '#bc8cff' : getAvatarColor(ev.senderId) }}>{DOMPurify.sanitize(resolveDisplayName(ev.senderId, ev.senderDisplayName), PURIFY_CONFIG)}</div>}<button onClick={() => revealViewOnce(ev.eventId, vp)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 12, border: '1px dashed rgba(88,166,255,0.3)', cursor: 'pointer', color: '#58a6ff', fontStyle: 'italic', fontSize: 13, width: '100%', textAlign: 'left' as const, background: 'none' }}><span>{'\uD83D\uDC41'}</span><span>{vt}</span><span style={{ color: '#8b949e', fontSize: 11 }}>Tap to view</span></button></div></div>);
        lastSid = ev.senderId; lastTs = md; lastDt = md; continue;
      }

      if (cc > 1) { els.push(<div key={`ps-${ev.eventId}`} style={styles.previousSessionBlock}><div style={styles.previousSessionBlockInner}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}><circle cx="7" cy="7" r="6" stroke="#8b949e" strokeWidth="1.2" fill="rgba(139,148,158,0.08)" /><rect x="5" y="6.5" width="4" height="3.2" rx="0.6" stroke="#8b949e" strokeWidth="0.9" fill="none" /><path d="M6 6.5V5.2a1 1 0 0 1 2 0V6.5" stroke="#8b949e" strokeWidth="0.9" strokeLinecap="round" fill="none" /></svg><span style={styles.previousSessionBlockText}>{cc} messages from a previous session</span><span style={styles.previousSessionInfoIcon} title="Forward secrecy: keys are unique per session">i</span></div><span style={styles.previousSessionLearnMore}>End-to-end encryption uses unique keys per session for forward secrecy</span></div>); const lr = messages[i + cc - 1]; lastSid = lr.event.senderId; lastTs = new Date(lr.event.originServerTs); lastDt = lastTs; continue; }

      const isFG = isNG, nm = messages[i + 1], isLG = !nm || nm.event.senderId !== ev.senderId || (new Date(nm.event.originServerTs).getTime() - md.getTime()) > GROUP_GAP_MS;
      // eslint-disable-next-line security/detect-object-injection
      els.push(<MessageBubble key={ev.eventId} decrypted={dec} isOwn={isOwn} isFirstInGroup={isFG} isLastInGroup={isLG} isDeleted={isDel} isExpired={isExp} isSelfDestructing={isSD} isViewOnce={!!isVO} hasPopIn={recentlyArrivedIds.has(ev.eventId)} hasError={hasErr} isMobile={isMobile} isAnonymous={isAnonymous} currentUserId={currentUserId} resolveDisplayName={resolveDisplayName} disappearingSettings={disappearingSettings} readReceiptMap={readReceiptMap} localReactions={localReactions} searchQuery={searchQuery} searchMatchIndex={searchMatchIndex} filteredMessages={filteredMessages} onContextMenu={handleMessageContextMenu} onClick={handleMessageClick} onReply={handleReplyToMessage} onForward={(eid) => void handleForwardMessage(eid)} onReact={(eid, emoji) => { void handleReact(eid, emoji); }} onShowReactionPicker={handleShowReactionPicker} onScrollToMessage={scrollToMessage} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onTouchMove={handleTouchMove} onConsumedOnce={handleConsumedOnce} onImageClick={handleImageClick} messageRef={el => { messageRefs.current[ev.eventId] = el; }} />);
      lastSid = ev.senderId; lastTs = md; lastDt = md;
    }
    return els;
  }, [messages, filteredMessages, currentUserId, deletedEventIds, expiredEventIds, selfDestructingIds, destroyedIds, disappearingSettings, hiddenOnceIds, viewedOnceIds, recentlyArrivedIds, localReactions, readReceiptMap, scrollToMessage, searchQuery, searchMatchIndex, unreadDividerEventId, handleMessageClick, isMobile, handleTouchStart, handleTouchEnd, handleTouchMove, revealViewOnce, getViewOnceType, isAnonymous, resolveDisplayName, handleReplyToMessage, handleForwardMessage, handleConsumedOnce, handleImageClick]);

  const renderWelcome = () => {
    if (messages.length > 0 || optimisticMessages.length > 0) return null;
    const isGroup = roomType === 'group';
    return (<div style={styles.welcomeContainer}><div style={{ ...styles.welcomeIconWrap, animation: 'frame-welcome-float 3s ease-in-out infinite' }}>{isGroup ? <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><circle cx="18" cy="16" r="6" stroke="#58a6ff" strokeWidth="1.5" fill="none" /><circle cx="30" cy="16" r="6" stroke="#58a6ff" strokeWidth="1.5" fill="none" /><path d="M6 38c0-6.627 5.373-12 12-12h12c6.627 0 12 5.373 12 12" stroke="#58a6ff" strokeWidth="1.5" fill="none" strokeLinecap="round" /></svg> : <svg width="48" height="48" viewBox="0 0 48 48" fill="none"><rect x="6" y="14" width="36" height="24" rx="6" stroke="#3fb950" strokeWidth="1.5" fill="none" /><path d="M6 20l18 10 18-10" stroke="#3fb950" strokeWidth="1.5" fill="none" /></svg>}</div><div style={styles.welcomeTitle}>{isGroup ? `Welcome to ${headerName}` : `This is the beginning of your encrypted conversation with ${headerName}`}</div><div style={styles.welcomeSubtitle}>{isGroup ? 'Messages in this group are end-to-end encrypted.' : 'Messages are secured with end-to-end encryption.'}</div><div style={{ ...styles.welcomeE2eeBadge, backgroundColor: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.2)' }}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ filter: 'drop-shadow(0 0 3px rgba(63,185,80,0.5))' }}><path d="M8 1L2 4v4.5c0 3.5 2.5 6.2 6 7.5 3.5-1.3 6-4 6-7.5V4L8 1z" stroke="#3fb950" strokeWidth="1.2" fill="rgba(63,185,80,0.1)" /><path d="M6 8.5l1.5 1.5L10.5 6" stroke="#3fb950" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg> F.R.A.M.E. E2EE</div></div>);
  };

  // Header callbacks
  const handleToggleSearch = useCallback(() => { setShowSearch(v => { if (!v) setTimeout(() => searchInputRef.current?.focus(), 0); return !v; }); if (showSearch) setSearchQuery(''); }, [showSearch]);
  const handleToggleDisappearingMenu = useCallback(() => setShowDisappearingMenu(v => !v), []);
  const handleUpdateDisappearing = useCallback(async (secs: number) => { try { const { updateRoomSettings } = await import('../api/roomsAPI'); await updateRoomSettings(roomId, secs === 0 ? { disappearingMessages: { enabled: false, timeoutSeconds: 0 } } : { disappearingMessages: { enabled: true, timeoutSeconds: secs } }); setDisappearingSettings(secs === 0 ? null : { enabled: true, timeoutSeconds: secs }); } catch (e) { console.error('Disappearing update failed:', e); } setShowDisappearingMenu(false); }, [roomId]);

  return (
    <div style={styles.container} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {!e2eeAnimDone && <EncryptionVisualizer roomId={roomId} onComplete={() => setE2eeAnimDone(true)} />}
      {isDragOver && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(63,185,80,0.06)', border: '3px dashed rgba(63,185,80,0.5)', borderRadius: 8, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', animation: 'frame-overlay-fade-in 0.2s ease-out', backdropFilter: 'blur(2px)' }}><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: '#3fb950', fontWeight: 600, fontSize: 16, padding: '32px 24px', backgroundColor: 'rgba(13,17,23,0.85)', borderRadius: 16, border: '1px solid rgba(63,185,80,0.3)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>Drop to attach<span style={{ fontSize: 12, color: '#8b949e', fontWeight: 400 }}>Release to add file</span></div></div>}
      <div style={{ height: 2, backgroundColor: '#3fb950', boxShadow: '0 0 8px rgba(63,185,80,0.4)', flexShrink: 0 }} />

      <ChatHeader roomId={roomId} currentUserId={currentUserId} memberUserIds={memberUserIds} roomDisplayName={roomDisplayName} roomType={roomType} memberCount={memberCount} isAnonymous={isAnonymous} isMobile={isMobile} isSyncing={isSyncing} disappearingSettings={disappearingSettings} showSearch={showSearch} showDisappearingMenu={showDisappearingMenu} onToggleSearch={handleToggleSearch} onToggleDisappearingMenu={handleToggleDisappearingMenu} onUpdateDisappearing={(secs: number) => { void handleUpdateDisappearing(secs); }} onLeave={onLeave} onOpenSettings={onOpenSettings} onRoomRenamed={onRoomRenamed} onShowMobileMoreMenu={() => setShowMobileMoreMenu(v => !v)} showToast={showToast} blockedUserIds={blockedUserIds} onBlockStatusChanged={onBlockStatusChanged} />

      {showSearch && <div style={{ ...styles.searchBar, ...(isMobile ? { position: 'relative' as const, zIndex: 50, padding: '8px 10px' } : {}) }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg><input ref={searchInputRef} type="text" style={{ ...styles.searchInput, ...(isMobile ? { fontSize: 16, padding: '8px 8px' } : {}) }} placeholder="Search messages..." value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }} onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchQuery(''); setSearchMatchIndex(0); } if (e.key === 'Enter' && filteredMessages.length > 0) { e.preventDefault(); setSearchMatchIndex(p => e.shiftKey ? (p - 1 + filteredMessages.length) % filteredMessages.length : (p + 1) % filteredMessages.length); } }} aria-label="Search messages" />{searchQuery && filteredMessages.length > 0 && <span style={{ fontSize: 11, color: '#8b949e', flexShrink: 0, whiteSpace: 'nowrap' }}>{Math.min(searchMatchIndex + 1, filteredMessages.length)} of {filteredMessages.length}</span>}{searchQuery && filteredMessages.length === 0 && <span style={{ fontSize: 11, color: '#f85149', flexShrink: 0, whiteSpace: 'nowrap' }}>No results</span>}{searchQuery && filteredMessages.length > 1 && <><button type="button" style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', padding: '2px 6px', fontSize: 14, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }} onClick={() => setSearchMatchIndex(p => (p - 1 + filteredMessages.length) % filteredMessages.length)} aria-label="Previous">&#8593;</button><button type="button" style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', padding: '2px 6px', fontSize: 14, lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }} onClick={() => setSearchMatchIndex(p => (p + 1) % filteredMessages.length)} aria-label="Next">&#8595;</button></>}<button type="button" style={{ ...styles.searchCloseButton, ...(isMobile ? { minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}) }} onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchMatchIndex(0); }} aria-label="Close">&#10005;</button></div>}

      {pinnedEventIds.length > 0 && showPinnedBar && !showSearch && (() => { const id = pinnedEventIds[pinnedEventIds.length - 1]; const m = messages.find(m => m.event.eventId === id); if (!m) return null; const b = m.plaintext && typeof m.plaintext.body === 'string' ? m.plaintext.body : 'Pinned message'; return <div style={styles.pinnedBar} onClick={() => scrollToMessage(id)}><div style={styles.pinnedBarLeft}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d29922" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><line x1="12" y1="17" x2="12" y2="22" /><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z" /></svg><div style={{ overflow: 'hidden', flex: 1 }}><div style={{ fontSize: 10, fontWeight: 600, color: '#d29922', marginBottom: 1 }}>Pinned</div><div style={{ fontSize: 12, color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{DOMPurify.sanitize(b.length > 80 ? b.slice(0, 80) + '...' : b, PURIFY_CONFIG)}</div></div></div><button type="button" style={styles.pinnedBarClose} onClick={e => { e.stopPropagation(); setShowPinnedBar(false); }} aria-label="Dismiss">&#10005;</button></div>; })()}

      {syncError && <div style={styles.syncErrorIndicator}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, animation: 'frame-spin 1.5s linear infinite' }}><circle cx="7" cy="7" r="5.5" stroke="#d29922" strokeWidth="1.2" strokeDasharray="20 12" fill="none" /></svg><span style={{ fontSize: 11, color: '#d29922' }}>Reconnecting...</span><button type="button" onClick={() => { syncBackoffRef.current = 1000; void syncLoop(++syncGenRef.current); }} style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 10, fontWeight: 600, backgroundColor: 'rgba(210,153,34,0.15)', color: '#d29922', border: '1px solid rgba(210,153,34,0.3)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Retry Now</button></div>}

      <div style={{ position: 'absolute' as const, top: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(180deg,rgba(13,17,23,0.7) 0%,transparent 100%)', pointerEvents: 'none' as const, zIndex: 2 }} />
      <div style={{ position: 'absolute' as const, bottom: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(0deg,rgba(13,17,23,0.7) 0%,transparent 100%)', pointerEvents: 'none' as const, zIndex: 2 }} />
      <div className="frame-chat-vignette" />
      {showDestructFlash && <div style={{ position: 'absolute' as const, inset: 0, zIndex: 50, backgroundColor: 'rgba(248,81,73,0.05)', pointerEvents: 'none' as const, animation: 'frame-destruct-flash 100ms ease-out forwards' }} />}

      <div ref={messageListRef} style={{ ...styles.messageList, position: 'relative' as const }} onScroll={handleScroll}>
        <div style={{ position: 'fixed' as const, bottom: 80, right: 24, pointerEvents: 'none' as const, opacity: 0.05, zIndex: 0, display: 'flex', alignItems: 'center', gap: 6 }} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 64 64" fill="none"><path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke="#58a6ff" strokeWidth="4" fill="rgba(88,166,255,0.15)" /><path d="M26 32l4 4 8-8" stroke="#3fb950" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg><span style={{ fontSize: 12, fontWeight: 700, color: '#c9d1d9', letterSpacing: 1.5 }}>F.R.A.M.E.</span></div>
        {showRoomSkeleton && messages.length === 0 ? <>{Array.from({ length: 4 }).map((_, i) => <SkeletonMessageBubble key={i} align={i % 3 === 0 ? 'right' : 'left'} />)}</> : <>
          {renderWelcome()}{renderedMessages}
          {optimisticMessages.map(om => <div key={om.id} style={{ display: 'flex', alignSelf: 'flex-end', maxWidth: isMobile ? '75%' : 'clamp(200px,65%,480px)', marginTop: 4, overflow: 'hidden' as const, ...(recentlySentIds.has(om.id) ? { animation: 'frame-msg-slide-up 0.3s cubic-bezier(0.34,1.56,0.64,1) forwards' } : {}) }}><div style={{ ...styles.messageBubble, ...styles.ownMessage, ...(om.status === 'failed' ? styles.optimisticFailed : styles.optimisticSending), borderRadius: 16, cursor: om.status === 'failed' ? 'pointer' : 'default' }} onClick={om.status === 'failed' ? () => handleRetry(om) : undefined}><div style={styles.messageBody}>{om.viewOnce && <span style={styles.viewOnceIcon}>&#128065;</span>}{om.body}</div><div style={styles.timestampRow}><span style={styles.timestamp} title={formatFullTimestamp(new Date(om.timestamp))}>{formatRelativeTime(new Date(om.timestamp))}</span>{om.status === 'sending' && <span style={styles.statusIcon} title="Sending">&#128337;</span>}{om.status === 'sent' && <span style={{ ...styles.statusIconSent, color: '#3fb950' }} title="Sent">&#10003;</span>}{om.status === 'failed' && <><span style={styles.statusIconFailed} title="Failed">&#10007;</span><button type="button" style={styles.retryInlineButton} onClick={() => handleRetry(om)} title="Retry">Retry</button></>}</div></div></div>)}
          {typingUsers.length > 0 && <div className={isMobile ? 'frame-typing-compact' : ''} style={{ ...styles.typingIndicator, display: 'flex', ...(isMobile ? { padding: '2px 6px', minHeight: 16 } : {}) }} aria-label="Typing">{typingUsers.map(u => <CipherTypingIndicator key={u} displayName={formatDisplayName(u)} />)}</div>}
          <div ref={messagesEndRef} />
        </>}
      </div>

      {showNewMessagesPill && <button type="button" className="frame-new-messages-pill" style={{ ...styles.newMessagesPill, ...(isMobile ? { bottom: 70 } : {}) }} onClick={scrollToBottom}>New messages</button>}

      {/* Blocked user banner — replaces chat input in blocked DMs */}
      {(() => {
        if (roomType === 'direct') {
          const otherUid = memberUserIds.find((id) => id !== currentUserId);
          if (otherUid && blockedUserIds?.has(otherUid)) {
            return (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 16px', borderTop: '1px solid #30363d', backgroundColor: '#161b22' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                <span style={{ fontSize: 13, color: '#f85149', fontWeight: 500 }}>You blocked this user.</span>
                <button type="button" style={{ padding: '5px 14px', fontSize: 12, fontWeight: 600, backgroundColor: 'rgba(35, 134, 54, 0.1)', color: '#3fb950', border: '1px solid rgba(35, 134, 54, 0.3)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => { void unblockUserAPI(otherUid).then(() => { showToast?.('success', 'User unblocked'); onBlockStatusChanged?.(); }).catch((err: unknown) => showToast?.('error', err instanceof Error ? err.message : 'Failed to unblock')); }}>Unblock</button>
              </div>
            );
          }
        }
        return <ChatInput isMobile={isMobile} isSending={isSending} inputValue={inputValue} viewOnceMode={viewOnceMode} isUploadingFile={isUploadingFile} uploadStatus={uploadStatus} replyTo={replyTo} isAnonymous={isAnonymous} pendingFile={pendingFile} isRecordingVoice={isRecordingVoice} voiceStream={voiceStream} showCamera={showCamera} cameraStream={cameraStream} onInputChange={handleTextareaChange} onKeyDown={handleKeyDown} onSend={() => void handleSend()} onSendFile={() => void handleSendFile()} onVoiceSend={(a, d, m) => void handleVoiceSend(a, d, m)} onCameraCapture={f => void handleCameraCapture(f)} onSetViewOnceMode={setViewOnceMode} onSetRecordingVoice={setIsRecordingVoice} onSetVoiceStream={setVoiceStream} onSetShowCamera={setShowCamera} onSetCameraStream={setCameraStream} onCancelReply={handleCancelReply} onStageFile={stageFile} onCancelPendingFile={cancelPendingFile} onFileSelect={handleFileSelect} showToast={showToast} textareaRef={textareaRef as React.RefObject<HTMLTextAreaElement>} getAvatarColor={getAvatarColor} />;
      })()}

      {contextMenuEventId && contextMenuPos && (isMobile ? <><div style={{ position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, animation: 'frame-overlay-fade-in 0.2s ease-out' }} onClick={() => { setContextMenuEventId(null); setContextMenuPos(null); }} /><div style={{ position: 'fixed' as const, bottom: 0, left: 0, right: 0, backgroundColor: '#21262d', borderTop: '1px solid #30363d', borderRadius: '16px 16px 0 0', padding: '8px 0', paddingBottom: 'env(safe-area-inset-bottom,8px)', zIndex: 9999, animation: 'frame-bottom-sheet-slide-up 0.25s cubic-bezier(0.32,0.72,0,1)', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)' }}><div style={{ width: 36, height: 4, backgroundColor: '#484f58', borderRadius: 2, margin: '4px auto 12px' }} />{[{ label: 'Reply', fn: () => handleReplyToMessage(contextMenuEventId), color: '#c9d1d9' }, { label: 'Forward', fn: () => void handleForwardMessage(contextMenuEventId), color: '#c9d1d9' }, { label: 'Copy Text', fn: () => handleCopyText(contextMenuEventId), color: '#c9d1d9' }, { label: pinnedEventIds.includes(contextMenuEventId) ? 'Unpin' : 'Pin', fn: () => void handleTogglePin(contextMenuEventId), color: '#d29922' }].map(a => <button key={a.label} type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: a.color, backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={a.fn}>{a.label}</button>)}{messages.find(m => m.event.eventId === contextMenuEventId)?.event.senderId === currentUserId && <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#f85149', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => void handleDeleteMessage(contextMenuEventId)}>Delete</button>}</div></> : <div style={{ ...styles.contextMenu, top: contextMenuPos.y, left: contextMenuPos.x }}>{[{ label: 'Reply', fn: () => handleReplyToMessage(contextMenuEventId), color: '#c9d1d9' }, { label: 'Forward', fn: () => void handleForwardMessage(contextMenuEventId), color: '#c9d1d9' }, { label: 'Copy Text', fn: () => handleCopyText(contextMenuEventId), color: '#c9d1d9' }, { label: pinnedEventIds.includes(contextMenuEventId) ? 'Unpin' : 'Pin', fn: () => void handleTogglePin(contextMenuEventId), color: '#d29922' }].map(a => <button key={a.label} type="button" className="frame-context-menu-item" style={{ ...styles.contextMenuItem, color: a.color }} onClick={a.fn}>{a.label}</button>)}{messages.find(m => m.event.eventId === contextMenuEventId)?.event.senderId === currentUserId && <button type="button" className="frame-context-menu-item" style={styles.contextMenuItem} onClick={() => void handleDeleteMessage(contextMenuEventId)}>Delete</button>}</div>)}

      {showForwardDialog && <div style={styles.forwardOverlay} onClick={() => { setShowForwardDialog(false); setForwardEventId(null); }}><div style={styles.forwardDialog} onClick={e => e.stopPropagation()}><div style={styles.forwardTitle}>Forward to...</div><div style={styles.forwardList}>{forwardRooms.length === 0 ? <div style={{ padding: 16, color: '#8b949e', textAlign: 'center' as const, fontSize: 13 }}>No other rooms</div> : forwardRooms.map(r => { const n = r.name || r.members.map(m => formatDisplayName(m.userId)).join(', ') || r.roomId; return <button key={r.roomId} type="button" style={styles.forwardRoomItem} onClick={() => void handleForwardToRoom(r.roomId, n)} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1c2128'; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}><div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: getAvatarColor(r.roomId), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, color: '#fff', flexShrink: 0 }}>{n.charAt(0).toUpperCase()}</div><span style={{ fontSize: 13, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{DOMPurify.sanitize(n, PURIFY_CONFIG)}</span></button>; })}</div><button type="button" style={styles.forwardCancel} onClick={() => { setShowForwardDialog(false); setForwardEventId(null); }}>Cancel</button></div></div>}

      {reactionPickerEventId && reactionPickerPos && <div style={{ ...styles.reactionPicker, top: reactionPickerPos.y, left: reactionPickerPos.x }} onClick={e => e.stopPropagation()}>{QUICK_REACTIONS.map(em => <button key={em} type="button" style={styles.reactionPickerEmoji} onClick={() => void handleReact(reactionPickerEventId, em)}>{em}</button>)}</div>}

      {viewerImage && <ImageViewer src={viewerImage.src} alt={viewerImage.alt} onClose={() => setViewerImage(null)} />}

      {isMobile && showMobileMoreMenu && <><div style={{ position: 'fixed' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9998, animation: 'frame-overlay-fade-in 0.2s ease-out' }} onClick={() => setShowMobileMoreMenu(false)} /><div style={{ position: 'fixed' as const, bottom: 0, left: 0, right: 0, backgroundColor: '#21262d', borderTop: '1px solid #30363d', borderRadius: '16px 16px 0 0', padding: '8px 0', paddingBottom: 'env(safe-area-inset-bottom,8px)', zIndex: 9999, animation: 'frame-bottom-sheet-slide-up 0.25s cubic-bezier(0.32,0.72,0,1)', boxShadow: '0 -4px 24px rgba(0,0,0,0.4)' }}><div style={{ width: 36, height: 4, backgroundColor: '#484f58', borderRadius: 2, margin: '4px auto 12px' }} /><button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: disappearingSettings?.enabled ? '#d29922' : '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); setShowDisappearingMenu(v => !v); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={disappearingSettings?.enabled ? '#d29922' : '#8b949e'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>{disappearingSettings?.enabled ? `Auto-delete \u00B7 ${disappearingSettings.timeoutSeconds < 3600 ? String(Math.floor(disappearingSettings.timeoutSeconds / 60)) + 'm' : disappearingSettings.timeoutSeconds < 86400 ? String(Math.floor(disappearingSettings.timeoutSeconds / 3600)) + 'h' : disappearingSettings.timeoutSeconds < 604800 ? String(Math.floor(disappearingSettings.timeoutSeconds / 86400)) + 'd' : String(Math.floor(disappearingSettings.timeoutSeconds / 604800)) + 'w'}` : 'Auto-delete'}</button><button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#c9d1d9', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); onOpenSettings?.(); }}>Room Info</button>{roomType === 'direct' && (() => { const otherUid = memberUserIds.find((id) => id !== currentUserId); if (!otherUid) return null; const isBlocked = blockedUserIds?.has(otherUid) ?? false; return <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: isBlocked ? '#3fb950' : '#f85149', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); void (isBlocked ? unblockUserAPI(otherUid) : blockUserAPI(otherUid)).then(() => { showToast?.(isBlocked ? 'success' : 'warning', isBlocked ? 'User unblocked' : 'User blocked'); onBlockStatusChanged?.(); }).catch((err: unknown) => showToast?.('error', err instanceof Error ? err.message : 'Failed')); }}>{isBlocked ? 'Unblock User' : 'Block User'}</button>; })()}{onLeave && <button type="button" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 20px', fontSize: 15, color: '#f85149', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', minHeight: 48, textAlign: 'left' as const }} onClick={() => { setShowMobileMoreMenu(false); onLeave(); }}>Leave Conversation</button>}</div></>}
    </div>
  );
};

export default React.memo(ChatWindow);
