/**
 * useAppInit — One-time app initialisation hook for F.R.A.M.E.
 *
 * Runs once after authentication to bootstrap all subsystems:
 *   1. Secure storage (IndexedDB with AES-256-GCM)
 *   2. Crypto engine (OlmMachine via vodozemac WASM)
 *   3. Key generation and upload
 *   4. Device registration
 *   5. Service worker and notification permissions
 *
 * Returns initialisation status so the UI can render a loading state
 * or proceed to the main app.
 */

import { useState, useEffect, useRef } from 'react';
import { initStorage } from '../storage/secureStorage';
import { initCrypto } from '../crypto/olmMachine';
import { generateAndUploadKeys } from '../crypto/keyManager';
import { registerCurrentDevice } from '../devices/deviceManager';
import {
  registerServiceWorker,
  requestNotificationPermission,
} from '../notifications';

export interface AppInitState {
  initialized: boolean;
  error: string | null;
}

/**
 * Initialise all F.R.A.M.E. subsystems after authentication.
 *
 * @param userId   - Authenticated user's ID (e.g. `@alice:frame.local`)
 * @param deviceId - Device identifier from the auth response
 */
export function useAppInit(
  userId: string | null,
  deviceId: string | null,
): AppInitState {
  const [state, setState] = useState<AppInitState>({
    initialized: false,
    error: null,
  });

  // Guard against double-invocation in React StrictMode
  const hasRun = useRef(false);

  useEffect(() => {
    if (!userId || !deviceId || hasRun.current) return;
    hasRun.current = true;

    let cancelled = false;

    async function bootstrap() {
      try {
        // 1. Initialise secure storage with a demo passphrase
        //    (in production this would come from user input or biometrics)
        await initStorage('frame-demo-passphrase');

        // 2. Initialise the crypto engine (vodozemac WASM + OlmMachine)
        await initCrypto(userId!, deviceId!);

        // 3. Generate real keys and upload to homeserver
        await generateAndUploadKeys(userId!, deviceId!);

        // 4. Register this device with the backend
        await registerCurrentDevice(userId!);

        // 5. Service worker + notifications (non-critical — failures are tolerated)
        try {
          await registerServiceWorker();
          await requestNotificationPermission();
        } catch (swErr) {
          console.warn(
            '[F.R.A.M.E.] Service worker or notification setup failed:',
            swErr,
          );
        }

        if (!cancelled) {
          setState({ initialized: true, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'App initialisation failed.';
          console.error('[F.R.A.M.E.] Initialisation error:', err);
          setState({ initialized: false, error: message });
        }
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, [userId, deviceId]);

  return state;
}
