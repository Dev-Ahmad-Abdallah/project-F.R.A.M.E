import React, { useState, useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { sendMessage, syncMessages, SyncEvent } from '../api/messagesAPI';
import {
  encryptForRoom,
  decryptEvent,
  processSyncResponse,
  DecryptedEvent,
} from '../crypto/sessionManager';

interface ChatWindowProps {
  roomId: string;
  currentUserId: string;
  /** User IDs of all room members (including current user) */
  memberUserIds: string[];
  // E2EE is always enabled — no plaintext bypass allowed (Security Finding 1)
}

/**
 * Chat UI component with Megolm group encryption.
 *
 * - Encrypts outgoing messages via encryptForRoom()
 * - Decrypts incoming events via decryptEvent()
 * - Shows encryption status per message (lock / warning icons)
 * - Handles decryption failures gracefully
 * - Sanitises all rendered content via DOMPurify
 */
const ChatWindow: React.FC<ChatWindowProps> = ({
  roomId,
  currentUserId,
  memberUserIds,
}) => {
  const [messages, setMessages] = useState<DecryptedEvent[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const nextBatchRef = useRef<string | undefined>(undefined);
  const abortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Decrypt a batch of sync events. Decryption errors are captured
   * per-event rather than failing the entire batch.
   */
  const decryptEvents = useCallback(
    async (events: SyncEvent[]): Promise<DecryptedEvent[]> => {
      const results: DecryptedEvent[] = [];
      for (const event of events) {
        const decrypted = await decryptEvent(event);
        results.push(decrypted);
      }
      return results;
    },
    [],
  );

  // Long-polling sync loop
  const syncLoop = useCallback(async () => {
    abortRef.current = false;

    while (!abortRef.current) {
      try {
        const result = await syncMessages(
          nextBatchRef.current,
          10000, // 10s long-poll timeout
          50,
        );

        if (abortRef.current) break;

        // Feed sync data through the crypto machine for to-device events
        await processSyncResponse(result);

        if (result.events.length > 0) {
          // Decrypt all incoming events
          const decryptedEvents = await decryptEvents(result.events);

          if (abortRef.current) break;

          setMessages((prev) => [...prev, ...decryptedEvents]);
          nextBatchRef.current = result.nextBatch;
        }

        setSyncError(null);
      } catch (err) {
        if (abortRef.current) break;
        setSyncError('Failed to sync messages');
        // Back off before retrying on error
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }, [decryptEvents]);

  useEffect(() => {
    // Reset state when room changes
    setMessages([]);
    nextBatchRef.current = undefined;
    abortRef.current = true;

    // Start sync loop after a tick to let abort take effect
    const timer = setTimeout(() => {
      syncLoop();
    }, 0);

    return () => {
      abortRef.current = true;
      clearTimeout(timer);
    };
  }, [roomId, syncLoop]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isSending) return;

    setIsSending(true);
    try {
      // Always encrypt — no plaintext bypass (Security Finding 1)
      const plaintext = {
        msgtype: 'm.text',
        body: text,
      };

      const encryptedContent = await encryptForRoom(
        roomId,
        'm.room.message',
        plaintext,
        memberUserIds,
      );

      await sendMessage(roomId, 'm.room.encrypted', encryptedContent);
      setInputValue('');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Render the message body for a decrypted event.
   * All content is sanitized via DOMPurify before display.
   */
  const renderMessageContent = (decrypted: DecryptedEvent): string => {
    if (decrypted.decryptionError) {
      return 'Unable to decrypt';
    }

    const content = decrypted.plaintext;
    if (!content) {
      return 'Unable to decrypt';
    }

    // Prefer the body field for text messages
    const raw =
      typeof content.body === 'string'
        ? content.body
        : typeof content.ciphertext === 'string'
          ? content.ciphertext
          : JSON.stringify(content);

    return DOMPurify.sanitize(raw);
  };

  /**
   * Render the encryption status icon for a message.
   */
  const renderEncryptionIcon = (decrypted: DecryptedEvent): React.ReactNode => {
    if (!decrypted.isEncrypted) {
      return null;
    }

    if (decrypted.decryptionError) {
      return (
        <span
          style={styles.encryptionWarning}
          title={`Decryption failed: ${decrypted.decryptionError}`}
        >
          &#9888;
        </span>
      );
    }

    return (
      <span style={styles.encryptionLock} title="Encrypted">
        &#128274;
      </span>
    );
  };

  return (
    <div style={styles.container}>
      {/* Encryption status header */}
      <div style={styles.header}>
        <span
          style={styles.encryptionBadge}
          title="End-to-end encryption enabled"
        >
          E2EE
        </span>
        <span style={styles.roomLabel}>Room: {DOMPurify.sanitize(roomId)}</span>
      </div>

      {/* Sync error banner */}
      {syncError && <div style={styles.errorBanner}>{syncError}</div>}

      {/* Message list */}
      <div style={styles.messageList}>
        {messages.length === 0 && (
          <div style={styles.emptyState}>No messages yet</div>
        )}
        {messages.map((decrypted) => {
          const event = decrypted.event;
          const isOwn = event.senderId === currentUserId;
          const hasError = decrypted.decryptionError !== null;

          return (
            <div
              key={event.eventId}
              style={{
                ...styles.messageBubble,
                ...(isOwn ? styles.ownMessage : styles.otherMessage),
                ...(hasError ? styles.errorMessage : {}),
              }}
            >
              {!isOwn && (
                <div style={styles.senderName}>
                  {DOMPurify.sanitize(event.senderId)}
                </div>
              )}
              <div style={styles.messageBody}>
                {renderEncryptionIcon(decrypted)}
                <span
                  style={hasError ? styles.errorText : undefined}
                >
                  {renderMessageContent(decrypted)}
                </span>
              </div>
              <div style={styles.timestamp}>
                {new Date(event.originServerTs).toLocaleTimeString()}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={styles.inputArea}>
        <input
          type="text"
          style={styles.input}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          disabled={isSending}
        />
        <button
          style={styles.sendButton}
          onClick={handleSend}
          disabled={isSending || !inputValue.trim()}
        >
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
};

// ── Inline styles ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    border: '1px solid #30363d',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0d1117',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid #30363d',
    backgroundColor: '#161b22',
  },
  encryptionBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    backgroundColor: 'rgba(35, 134, 54, 0.15)',
    color: '#3fb950',
  },
  encryptionBadgeDisabled: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    backgroundColor: 'rgba(187, 128, 9, 0.15)',
    color: '#d29922',
  },
  roomLabel: {
    fontSize: 13,
    color: '#c9d1d9',
  },
  errorBanner: {
    padding: '6px 12px',
    backgroundColor: '#3d1f28',
    color: '#f85149',
    fontSize: 13,
  },
  messageList: {
    flex: 1,
    overflowY: 'auto',
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyState: {
    textAlign: 'center',
    color: '#8b949e',
    marginTop: 40,
    fontSize: 14,
  },
  messageBubble: {
    maxWidth: '70%',
    padding: '8px 12px',
    borderRadius: 12,
    fontSize: 14,
    lineHeight: 1.4,
    wordBreak: 'break-word',
  },
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#58a6ff',
    color: '#ffffff',
  },
  otherMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#21262d',
    color: '#c9d1d9',
  },
  errorMessage: {
    opacity: 0.7,
    borderLeft: '3px solid #f85149',
  },
  senderName: {
    fontSize: 11,
    fontWeight: 600,
    marginBottom: 2,
    color: '#c9d1d9',
  },
  messageBody: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 4,
  },
  encryptionLock: {
    fontSize: 12,
    flexShrink: 0,
    marginTop: 1,
  },
  encryptionWarning: {
    fontSize: 14,
    color: '#f85149',
    flexShrink: 0,
    marginTop: -1,
  },
  errorText: {
    fontStyle: 'italic',
    opacity: 0.8,
  },
  timestamp: {
    fontSize: 10,
    marginTop: 4,
    opacity: 0.7,
    textAlign: 'right',
  },
  inputArea: {
    display: 'flex',
    gap: 8,
    padding: 12,
    borderTop: '1px solid #30363d',
    backgroundColor: '#161b22',
  },
  input: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 20,
    border: '1px solid #30363d',
    backgroundColor: '#0d1117',
    color: '#c9d1d9',
    fontSize: 14,
    outline: 'none',
  },
  sendButton: {
    padding: '8px 16px',
    borderRadius: 20,
    border: 'none',
    backgroundColor: '#58a6ff',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

export default ChatWindow;
