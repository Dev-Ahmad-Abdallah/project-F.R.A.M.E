/**
 * useToast — Global toast notification state manager.
 *
 * Provides `showToast(type, message, options?)` and a `toasts` array.
 * Toasts auto-dismiss after 5 seconds by default (configurable).
 * Set `persistent: true` to prevent auto-dismiss.
 */

import { useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  persistent: boolean;
  duration: number;
  createdAt: number;
  /** Optional click handler — makes the entire toast body clickable. */
  onClick?: () => void;
}

export interface ShowToastOptions {
  /** If true, toast will not auto-dismiss. Default: false */
  persistent?: boolean;
  /** Auto-dismiss duration in ms. Default: 5000 */
  duration?: number;
  /**
   * Deduplicate key. If a toast with this key already exists,
   * it will be replaced instead of stacking a duplicate.
   */
  dedupeKey?: string;
  /** Optional click handler — makes the entire toast body clickable. */
  onClick?: () => void;
}

let globalIdCounter = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dedupeMapRef = useRef<Map<string, string>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    // Clean up dedupe entries pointing to this id
    for (const [key, val] of dedupeMapRef.current.entries()) {
      if (val === id) {
        dedupeMapRef.current.delete(key);
      }
    }
  }, []);

  const showToast = useCallback(
    (type: ToastType, message: string, options?: ShowToastOptions) => {
      const persistent = options?.persistent ?? false;
      const duration = options?.duration ?? 5000;
      const dedupeKey = options?.dedupeKey;

      // If dedupe key provided and toast already exists, replace it
      if (dedupeKey && dedupeMapRef.current.has(dedupeKey)) {
        const existingId = dedupeMapRef.current.get(dedupeKey) as string;
        // Remove old timer
        const oldTimer = timersRef.current.get(existingId);
        if (oldTimer) {
          clearTimeout(oldTimer);
          timersRef.current.delete(existingId);
        }
        // Remove old toast
        setToasts((prev) => prev.filter((t) => t.id !== existingId));
        dedupeMapRef.current.delete(dedupeKey);
      }

      const id = `toast-${++globalIdCounter}-${Date.now()}`;

      if (dedupeKey) {
        dedupeMapRef.current.set(dedupeKey, id);
      }

      const toast: Toast = {
        id,
        type,
        message,
        persistent,
        duration,
        createdAt: Date.now(),
        onClick: options?.onClick,
      };

      setToasts((prev) => [toast, ...prev]);

      if (!persistent) {
        const timer = setTimeout(() => {
          dismissToast(id);
        }, duration);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismissToast],
  );

  return { toasts, showToast, dismissToast };
}
