/**
 * BackupSettings — Key backup export/import UI for account recovery.
 *
 * Provides:
 *   - "Export Keys" button — prompts for passphrase, downloads encrypted JSON
 *   - "Import Keys" button — file picker + passphrase, imports keys
 *   - Auto-backup reminder if user has never exported keys
 *
 * Dark theme styling consistent with DeviceList and other settings panels.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { FONT_BODY, FONT_MONO } from '../globalStyles';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  exportRoomKeys,
  importRoomKeys,
  type KeyImportResult,
} from '../crypto/olmMachine';
import { unlockRank } from '../utils/rankSystem';

// ── Local storage key for tracking whether user has ever exported ──

const BACKUP_EXPORTED_KEY = 'frame-key-backup-exported';

function hasExportedBefore(): boolean {
  try {
    return localStorage.getItem(BACKUP_EXPORTED_KEY) === 'true';
  } catch {
    return false;
  }
}

function markExported(): void {
  try {
    localStorage.setItem(BACKUP_EXPORTED_KEY, 'true');
  } catch {
    // localStorage may be unavailable in some contexts
  }
}

// ── Component ──

const BackupSettings: React.FC = () => {
  const isMobile = useIsMobile();

  // Export state
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmPassphrase, setExportConfirmPassphrase] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Import state
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<KeyImportResult | null>(null);

  // Reminder state
  const [showReminder, setShowReminder] = useState(!hasExportedBefore());
  const [showExportForm, setShowExportForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dismiss reminder after a successful export
  useEffect(() => {
    if (exportSuccess) {
      setShowReminder(false);
    }
  }, [exportSuccess]);

  // ── Export handler ──

  const handleExport = useCallback(async () => {
    setExportError(null);
    setExportSuccess(false);

    if (!exportPassphrase) {
      setExportError('Please enter a passphrase.');
      return;
    }
    if (exportPassphrase.length < 8) {
      setExportError('Passphrase must be at least 8 characters.');
      return;
    }
    if (exportPassphrase !== exportConfirmPassphrase) {
      setExportError('Passphrases do not match.');
      return;
    }

    setExporting(true);
    try {
      const encrypted = await exportRoomKeys(exportPassphrase);

      // Trigger download
      const blob = new Blob([encrypted], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frame-keys-${new Date().toISOString().slice(0, 10)}.frame-keys`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      markExported();
      unlockRank('cipher');
      setExportSuccess(true);
      setExportPassphrase('');
      setExportConfirmPassphrase('');
    } catch (err) {
      setExportError(
        err instanceof Error ? err.message : 'Failed to export keys.',
      );
    } finally {
      setExporting(false);
    }
  }, [exportPassphrase, exportConfirmPassphrase]);

  // ── Import handler ──

  const handleImport = useCallback(async () => {
    setImportError(null);
    setImportResult(null);

    if (!importFile) {
      setImportError('Please select a .frame-keys backup file.');
      return;
    }
    if (!importPassphrase) {
      setImportError('Please enter the passphrase used during export.');
      return;
    }

    setImporting(true);
    try {
      const fileText = await importFile.text();
      const result = await importRoomKeys(fileText, importPassphrase);
      setImportResult(result);
      setImportPassphrase('');
      setImportFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to import keys.',
      );
    } finally {
      setImporting(false);
    }
  }, [importFile, importPassphrase]);

  // ── Render ──

  return (
    <div
      style={{
        ...styles.container,
        ...(isMobile ? { maxWidth: '100%', padding: 16, borderRadius: 0 } : {}),
      }}
    >
      <h2 style={styles.heading}>Key Backup</h2>

      <p style={styles.infoText}>
        Export your encryption keys to recover messages if you lose access to this
        device. The backup file is protected with a passphrase you choose.
      </p>

      {/* Auto-backup reminder */}
      {showReminder && (
        <div style={styles.reminderBanner}>
          <span style={styles.reminderIcon}>!</span>
          <span style={styles.reminderText}>
            You have not backed up your encryption keys. If you lose this device,
            you will not be able to read your encrypted messages. Export your keys
            now to stay safe.
          </span>
          <button
            type="button"
            style={styles.reminderDismiss}
            onClick={() => setShowReminder(false)}
            aria-label="Dismiss reminder"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── Export Section ── */}
      <div style={styles.section}>
        <button
          type="button"
          style={{
            ...styles.sectionToggle,
            ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
          }}
          onClick={() => {
            setShowExportForm(!showExportForm);
            setExportError(null);
            setExportSuccess(false);
          }}
        >
          {showExportForm ? 'Hide Export' : 'Export Keys'}
        </button>

        {showExportForm && (
          <div style={styles.formArea}>
            <label style={styles.label}>
              Passphrase
              <input
                type="password"
                value={exportPassphrase}
                onChange={(e) => setExportPassphrase(e.target.value)}
                style={{
                  ...styles.input,
                  ...(isMobile ? { fontSize: 16 } : {}),
                }}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </label>
            <label style={styles.label}>
              Confirm passphrase
              <input
                type="password"
                value={exportConfirmPassphrase}
                onChange={(e) => setExportConfirmPassphrase(e.target.value)}
                style={{
                  ...styles.input,
                  ...(isMobile ? { fontSize: 16 } : {}),
                }}
                placeholder="Re-enter passphrase"
                autoComplete="new-password"
              />
            </label>

            {exportError && <div style={styles.errorText}>{exportError}</div>}
            {exportSuccess && (
              <div style={styles.successText}>
                Keys exported successfully. Store the file somewhere safe.
              </div>
            )}

            <button
              type="button"
              style={{
                ...styles.actionButton,
                ...(exporting ? styles.buttonDisabled : {}),
                ...(isMobile ? { width: '100%', minHeight: 48, fontSize: 14 } : {}),
              }}
              onClick={() => void handleExport()}
              disabled={exporting}
            >
              {exporting ? 'Exporting...' : 'Download Encrypted Backup'}
            </button>
          </div>
        )}
      </div>

      {/* ── Import Section ── */}
      <div style={styles.section}>
        <button
          type="button"
          style={{
            ...styles.sectionToggle,
            ...(isMobile ? { width: '100%', minHeight: 48 } : {}),
          }}
          onClick={() => {
            setShowImportForm(!showImportForm);
            setImportError(null);
            setImportResult(null);
          }}
        >
          {showImportForm ? 'Hide Import' : 'Import Keys'}
        </button>

        {showImportForm && (
          <div style={styles.formArea}>
            <label style={styles.label}>
              Backup file
              <input
                ref={fileInputRef}
                type="file"
                accept=".frame-keys,application/json"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                style={{
                  ...styles.fileInput,
                  ...(isMobile ? { fontSize: 14 } : {}),
                }}
              />
            </label>
            {importFile && (
              <span style={styles.fileName}>{importFile.name}</span>
            )}

            <label style={styles.label}>
              Passphrase
              <input
                type="password"
                value={importPassphrase}
                onChange={(e) => setImportPassphrase(e.target.value)}
                style={{
                  ...styles.input,
                  ...(isMobile ? { fontSize: 16 } : {}),
                }}
                placeholder="Passphrase used during export"
                autoComplete="current-password"
              />
            </label>

            {importError && <div style={styles.errorText}>{importError}</div>}
            {importResult && (
              <div style={styles.successText}>
                Imported {importResult.importedCount} of{' '}
                {importResult.totalCount} keys successfully.
              </div>
            )}

            <button
              type="button"
              style={{
                ...styles.actionButton,
                ...(importing ? styles.buttonDisabled : {}),
                ...(isMobile ? { width: '100%', minHeight: 48, fontSize: 14 } : {}),
              }}
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Restore Keys from Backup'}
            </button>
          </div>
        )}
      </div>

      <p style={styles.footnote}>
        Backup files use AES-256-GCM encryption with PBKDF2 key derivation
        (100,000 iterations). Keep the file and passphrase in a secure location.
      </p>
    </div>
  );
};

// ── Styles (dark theme, consistent with DeviceList) ──

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
  reminderBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 14px',
    backgroundColor: '#2d1b00',
    border: '1px solid #6e4b00',
    borderRadius: 6,
    fontSize: 13,
    color: '#d29922',
    lineHeight: 1.4,
  },
  reminderIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: '50%',
    backgroundColor: '#6e4b00',
    color: '#ffd33d',
    fontWeight: 700,
    fontSize: 14,
    flexShrink: 0,
  },
  reminderText: {
    flex: 1,
  },
  reminderDismiss: {
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 500,
    backgroundColor: 'transparent',
    color: '#d29922',
    border: '1px solid #6e4b00',
    borderRadius: 4,
    cursor: 'pointer',
    flexShrink: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  sectionToggle: {
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
  formArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: 16,
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 13,
    fontWeight: 500,
    color: '#c9d1d9',
  },
  input: {
    padding: '8px 12px',
    fontSize: 14,
    fontFamily: FONT_MONO,
    backgroundColor: '#161b22',
    color: '#e6edf3',
    border: '1px solid #30363d',
    borderRadius: 6,
    outline: 'none',
  },
  fileInput: {
    padding: '6px 0',
    fontSize: 13,
    color: '#c9d1d9',
  },
  fileName: {
    fontSize: 12,
    color: '#8b949e',
    fontFamily: FONT_MONO,
  },
  actionButton: {
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    backgroundColor: '#238636',
    color: '#ffffff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  errorText: {
    fontSize: 13,
    color: '#f85149',
    padding: '6px 10px',
    backgroundColor: '#3d1f28',
    border: '1px solid #6e3630',
    borderRadius: 4,
  },
  successText: {
    fontSize: 13,
    color: '#3fb950',
    padding: '6px 10px',
    backgroundColor: '#0d2818',
    border: '1px solid #238636',
    borderRadius: 4,
  },
  footnote: {
    margin: 0,
    fontSize: 11,
    color: '#6e7681',
    lineHeight: 1.4,
  },
};

export default BackupSettings;
