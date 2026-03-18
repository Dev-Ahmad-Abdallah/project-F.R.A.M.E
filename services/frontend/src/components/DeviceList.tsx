/**
 * DeviceList — Settings view showing all linked devices.
 *
 * Lists every device on the account with display name, last seen time,
 * verification status, and a remove button. The current device is
 * highlighted with a "This device" indicator.
 */

import React, { useState, useEffect, useCallback } from 'react';
import VerificationBadge from './VerificationBadge';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import {
  getKnownDevices,
  getDeviceList,
  removeDevice,
  detectNewDevices,
  addKnownDevice,
  type KnownDevice,
} from '../devices/deviceManager';
import type { DeviceInfo } from '../api/devicesAPI';

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
  const [devices, setDevices] = useState<KnownDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

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

      // Reload known devices to include any newly added
      const updatedKnown = await getKnownDevices(userId);
      setDevices(updatedKnown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, [userId, onUnknownDevice]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const handleRemove = useCallback(
    async (deviceId: string) => {
      if (deviceId === currentDeviceId) return; // Cannot remove current device

      setRemovingId(deviceId);
      try {
        await removeDevice(userId, deviceId);
        setDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove device');
      } finally {
        setRemovingId(null);
      }
    },
    [userId, currentDeviceId],
  );

  const formatLastSeen = (isoDate?: string): string => {
    if (!isoDate) return 'Never';
    try {
      return new Date(isoDate).toLocaleString();
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
    <div style={styles.container}>
      <h2 style={styles.heading}>Linked Devices</h2>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {devices.length === 0 ? (
        <p style={styles.emptyText}>No devices found.</p>
      ) : (
        <div style={styles.list}>
          {devices.map((device) => {
            const isCurrent = device.deviceId === currentDeviceId;
            const isRemoving = removingId === device.deviceId;

            return (
              <div
                key={device.deviceId}
                style={{
                  ...styles.deviceRow,
                  ...(isCurrent ? styles.currentDeviceRow : {}),
                }}
              >
                <div style={styles.deviceInfo}>
                  <div style={styles.deviceHeader}>
                    <VerificationBadge verified={device.verified} size="small" />
                    <span style={styles.deviceName}>
                      {device.deviceDisplayName || 'Unnamed Device'}
                    </span>
                    {isCurrent && (
                      <span style={styles.currentBadge}>This device</span>
                    )}
                  </div>
                  <div style={styles.deviceMeta}>
                    <span style={styles.deviceId}>
                      ID: {device.deviceId.slice(0, 12)}...
                    </span>
                    <span style={styles.lastSeen}>
                      Last seen: {formatLastSeen(device.lastSeen)}
                    </span>
                  </div>
                </div>

                <div style={styles.deviceActions}>
                  {!isCurrent && (
                    <button
                      type="button"
                      style={{
                        ...styles.removeButton,
                        ...(isRemoving ? styles.buttonDisabled : {}),
                      }}
                      onClick={() => handleRemove(device.deviceId)}
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

      <button
        type="button"
        style={styles.refreshButton}
        onClick={loadDevices}
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
  },
  currentDeviceRow: {
    borderColor: '#238636',
    backgroundColor: '#0d1117',
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
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
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
