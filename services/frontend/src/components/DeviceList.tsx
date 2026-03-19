/**
 * DeviceList — Settings view showing all linked devices.
 *
 * Lists every device on the account with display name, last seen time,
 * verification status, and a remove button. The current device is
 * highlighted with a "This device" indicator.
 *
 * Visual polish: staggered fade-in entry animation for device rows,
 * gentle pulse on "This device" badge (Signal / Apple inspired).
 */

import React, { useState, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { PURIFY_CONFIG } from '../utils/purifyConfig';
import VerificationBadge from './VerificationBadge';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getKnownDevices,
  getDeviceList,
  removeDevice,
  detectNewDevices,
  addKnownDevice,
  type KnownDevice,
} from '../devices/deviceManager';
import type { DeviceInfo } from '../api/devicesAPI';

// ── Keyframes (injected once) ──

const DEVICE_LIST_KEYFRAMES_ID = 'frame-device-list-keyframes';

function injectKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(DEVICE_LIST_KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = DEVICE_LIST_KEYFRAMES_ID;
  style.textContent = `
    @keyframes frameDeviceRowFadeIn {
      0% { opacity: 0; transform: translateY(12px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes frameCurrentBadgePulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(35, 134, 54, 0.5); }
      50% { box-shadow: 0 0 8px 3px rgba(35, 134, 54, 0.35); }
    }
    @keyframes frameDeviceRowHoverGlow {
      0% { border-color: #30363d; }
      100% { border-color: #484f58; }
    }
  `;
  document.head.appendChild(style);
}

// ── Types ──

interface DeviceListProps {
  userId: string;
  currentDeviceId: string;
  /** Called when an unknown device is detected. */
  onUnknownDevice?: (device: DeviceInfo) => void;
}

// ── Component ──

const DeviceList: React.FC<DeviceListProps> = ({
  userId,
  currentDeviceId,
  onUnknownDevice,
}) => {
  const isMobile = useIsMobile();
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => { injectKeyframes(); }, []);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch server device list and local known devices in parallel
      const [serverDevices, knownDevices] = await Promise.all([
        getDeviceList(userId),
        getKnownDevices(userId),
      ]);

      // Detect any new unknown devices
      const unknown = detectNewDevices(serverDevices, knownDevices);
      if (unknown.length > 0 && onUnknownDevice) {
        // Report the first unknown device — caller can handle it
        onUnknownDevice(unknown[0]);
      }

      // Add unknown devices to known list (as unverified) so they show up
      for (const ud of unknown) {
        await addKnownDevice(userId, ud);
      }

      // Reload known devices to include any newly added, then deduplicate by deviceId
      const updatedKnown = await getKnownDevices(userId);
      const seen = new Map<string, KnownDevice>();
      for (const d of updatedKnown) {
        seen.set(d.deviceId, d);
      }
      setDevices(Array.from(seen.values()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [userId, onUnknownDevice]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const handleRemoveRequest = useCallback(
    (deviceId: string) => {
      if (deviceId === currentDeviceId) return;
      setConfirmRemoveId(deviceId);
    },
    [currentDeviceId],
  );

  const handleRemoveConfirm = useCallback(async () => {
    if (!confirmRemoveId) return;
    const deviceId = confirmRemoveId;
    setConfirmRemoveId(null);
    setRemovingId(deviceId);
    try {
      await removeDevice(userId, deviceId);
      setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove device');
    } finally {
      setRemovingId(null);
    }
  }, [userId, confirmRemoveId]);

  const formatLastSeen = (isoDate?: string): string => {
    if (!isoDate) return 'Never';
    try {
      const date = new Date(isoDate);
      const now = Date.now();
      const diffMs = now - date.getTime();
      if (diffMs < 0) return 'Just now';
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return 'Just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      if (diffDay < 30) return `${diffDay}d ago`;
      return date.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  // ── Render ──

  if (loading) {
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Linked Devices</h2>
        <p style={styles.loadingText}>Loading devices...</p>
      </div>
    );
  }

  return (
    <div style={{
      ...styles.container,
      ...(isMobile ? { maxWidth: '100%', padding: 16, borderRadius: 0 } : {}),
    }}>
      <h2 style={styles.heading}>Linked Devices</h2>

      <p style={styles.infoText}>
        Each browser or login session creates a unique encryption device.
        You can remove old devices you no longer use.
      </p>

      {error && <div style={styles.errorBanner}>{DOMPurify.sanitize(error, PURIFY_CONFIG)}</div>}

      {devices.length === 0 ? (
        <p style={styles.emptyText}>No devices found.</p>
      ) : (
        <div style={styles.list}>
          {devices.map((device, index) => {
            const isCurrent = device.deviceId === currentDeviceId;
            const isRemoving = removingId === device.deviceId;

            return (
              <div
                key={device.deviceId}
                style={{
                  ...styles.deviceRow,
                  ...(isCurrent ? styles.currentDeviceRow : {}),
                  ...(isMobile ? {
                    flexDirection: 'column' as const,
                    alignItems: 'stretch',
                    gap: 10,
                    padding: '12px 14px',
                  } : {}),
                  // Staggered fade-in animation
                  animation: `frameDeviceRowFadeIn 0.4s ease-out ${index * 0.07}s both`,
                }}
              >
                <div style={styles.deviceInfo}>
                  <div style={{
                    ...styles.deviceHeader,
                    ...(isMobile ? { flexWrap: 'wrap' as const } : {}),
                  }}>
                    <VerificationBadge verified={device.verified} size="small" />
                    <span style={styles.deviceName}>
                      {DOMPurify.sanitize(device.deviceDisplayName || 'Unnamed Device', PURIFY_CONFIG)}
                    </span>
                    {isCurrent && (
                      <span style={styles.currentBadge}>This device</span>
                    )}
                  </div>
                  <div style={{
                    ...styles.deviceMeta,
                    ...(isMobile ? { flexDirection: 'column' as const, gap: 2 } : {}),
                  }}>
                    <span style={styles.deviceId}>
                      ID: {DOMPurify.sanitize(device.deviceId.slice(0, 12), PURIFY_CONFIG)}...
                    </span>
                    <span style={styles.lastSeen}>
                      Last seen: {formatLastSeen(device.lastSeen)}
                    </span>
                  </div>
                  {device.fingerprint && (
                    <div style={styles.deviceKey}>
                      Key: {DOMPurify.sanitize(device.fingerprint.slice(0, 20), PURIFY_CONFIG)}...
                    </div>
                  )}
                </div>

                <div style={{
                  ...styles.deviceActions,
                  ...(isMobile ? { alignSelf: 'stretch' } : {}),
                }}>
                  {!isCurrent && (
                    <button
                      type="button"
                      style={{
                        ...styles.removeButton,
                        ...(isRemoving ? styles.buttonDisabled : {}),
                        ...(isMobile ? { width: '100%', minHeight: 44 } : {}),
                      }}
                      onClick={() => handleRemoveRequest(device.deviceId)}
                      disabled={isRemoving}
                    >
                      {isRemoving ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation dialog for device removal */}
      {confirmRemoveId && (
        <div style={styles.confirmOverlay}>
          <div style={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-label="Confirm device removal">
            <p style={styles.confirmText}>
              Remove device <strong>{DOMPurify.sanitize(confirmRemoveId.slice(0, 12), PURIFY_CONFIG)}...</strong>? This will revoke its access.
            </p>
            <div style={styles.confirmActions}>
              <button
                type="button"
                style={styles.confirmCancel}
                onClick={() => setConfirmRemoveId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={styles.confirmRemove}
                onClick={() => void handleRemoveConfirm()}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        style={{
          ...styles.refreshButton,
          ...(isMobile ? { alignSelf: 'stretch', minHeight: 44 } : {}),
        }}
        onClick={() => void loadDevices()}
        disabled={loading}
      >
        Refresh
      </button>
    </div>
  );
};

// ── Styles (dark theme) ──

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 24,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    color: '#c9d1d9',
    fontFamily: FONT_BODY,
    maxWidth: 560,
  },
  heading: {
    margin: 0,
    fontSize: 20,
    fontWeight: 600,
    color: '#f0f6fc',
  },
  infoText: {
    margin: 0,
    fontSize: 13,
    color: '#8b949e',
    lineHeight: 1.5,
    fontStyle: 'italic',
  },
  loadingText: {
    margin: 0,
    fontSize: 14,
    color: '#8b949e',
  },
  emptyText: {
    margin: 0,
    fontSize: 14,
    color: '#8b949e',
    fontStyle: 'italic',
  },
  errorBanner: {
    padding: '8px 12px',
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 6,
    fontSize: 13,
    color: '#f85149',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  deviceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    gap: 12,
    transition: 'border-color 0.2s ease, background-color 0.2s ease',
  },
  currentDeviceRow: {
    borderColor: '#238636',
    backgroundColor: '#0d1117',
    boxShadow: '0 0 12px rgba(35, 134, 54, 0.1)',
  },
  deviceInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: 1,
    minWidth: 0,
  },
  deviceHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  deviceName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e6edf3',
  },
  currentBadge: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    backgroundColor: '#238636',
    color: '#ffffff',
    borderRadius: 10,
    whiteSpace: 'nowrap',
    animation: 'frameCurrentBadgePulse 2.5s ease-in-out infinite',
  },
  deviceMeta: {
    display: 'flex',
    gap: 16,
    marginTop: 2,
  },
  deviceId: {
    fontSize: 12,
    color: '#8b949e',
    fontFamily: FONT_MONO,
  },
  lastSeen: {
    fontSize: 12,
    color: '#8b949e',
  },
  deviceActions: {
    flexShrink: 0,
  },
  removeButton: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'background-color 0.15s, transform 0.1s',
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  deviceKey: {
    fontSize: 11,
    color: '#8b949e',
    fontFamily: FONT_MONO,
    marginTop: 2,
  },
  confirmOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  confirmDialog: {
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: 24,
    maxWidth: 400,
    width: '90%',
  },
  confirmText: {
    margin: '0 0 16px',
    fontSize: 14,
    color: '#c9d1d9',
    lineHeight: 1.5,
  },
  confirmActions: {
    display: 'flex',
    gap: 12,
    justifyContent: 'flex-end',
  },
  confirmCancel: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
  },
  confirmRemove: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#da3633',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
  },
  refreshButton: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    backgroundColor: '#21262d',
    color: '#c9d1d9',
    border: '1px solid #30363d',
    borderRadius: 6,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
};

export default DeviceList;
