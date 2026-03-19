import React, { useState, useRef, useEffect, useCallback } from 'react';

interface VoiceRecorderProps {
  onSend: (audioBase64: string, durationMs: number) => void;
  onCancel: () => void;
}

const MAX_DURATION_S = 60;
const WARNING_THRESHOLD_S = 50;

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onSend, onCancel }) => {
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'error'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [analyserData, setAnalyserData] = useState<number[]>(new Array(24).fill(0));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const updateWaveform = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    // Sample 24 bars from the frequency data
    const bars: number[] = [];
    const step = Math.floor(data.length / 24);
    for (let i = 0; i < 24; i++) {
      bars.push(data[i * step] / 255);
    }
    setAnalyserData(bars);
    animFrameRef.current = requestAnimationFrame(updateWaveform);
  }, []);

  const startRecording = useCallback(async () => {
    setState('requesting');
    setErrorMsg('');
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up analyser for waveform
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Determine supported mime type
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = '';
        }
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const durationMs = Date.now() - startTimeRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          if (base64) {
            onSend(base64, durationMs);
          }
        };
        reader.readAsDataURL(blob);
        cleanup();
      };

      recorder.start(250); // collect chunks every 250ms
      startTimeRef.current = Date.now();
      setState('recording');
      setElapsed(0);

      // Start waveform animation
      updateWaveform();

      // Start timer
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const sec = Math.floor((now - startTimeRef.current) / 1000);
        setElapsed(sec);
        if (sec >= MAX_DURATION_S) {
          recorder.stop();
        }
      }, 200);
    } catch (err: unknown) {
      cleanup();
      setState('error');
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setErrorMsg('Microphone access denied. Please allow microphone permission in your browser settings.');
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setErrorMsg('No microphone found. Please connect a microphone and try again.');
      } else {
        setErrorMsg('Could not access microphone. Please check your browser permissions.');
      }
    }
  }, [onSend, cleanup, updateWaveform]);

  // Auto-start recording on mount
  useEffect(() => {
    void startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      // Remove onstop handler so it doesn't trigger onSend
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    cleanup();
    onCancel();
  }, [cleanup, onCancel]);

  const handleStop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const showWarning = elapsed >= WARNING_THRESHOLD_S && elapsed < MAX_DURATION_S;
  const remaining = MAX_DURATION_S - elapsed;

  if (state === 'error') {
    return (
      <div style={recStyles.container}>
        <div style={recStyles.errorContainer}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <span style={recStyles.errorText}>{errorMsg}</span>
          <button type="button" onClick={onCancel} style={recStyles.dismissBtn}>Dismiss</button>
        </div>
      </div>
    );
  }

  if (state === 'idle' || state === 'requesting') {
    return (
      <div style={recStyles.container}>
        <div style={recStyles.requestingContainer}>
          <div style={recStyles.spinner} />
          <span style={{ color: '#8b949e', fontSize: 13 }}>Requesting microphone access...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={recStyles.container}>
      <div style={recStyles.recordingRow}>
        {/* Cancel button */}
        <button
          type="button"
          onClick={handleCancel}
          style={recStyles.cancelBtn}
          title="Cancel recording"
          aria-label="Cancel recording"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Recording indicator */}
        <div style={recStyles.recDot} />

        {/* Timer */}
        <span style={{
          ...recStyles.timer,
          color: showWarning ? '#f85149' : '#e6edf3',
        }}>
          {formatTime(elapsed)}
        </span>

        {/* Warning text */}
        {showWarning && (
          <span style={recStyles.warningText}>
            {remaining}s remaining
          </span>
        )}

        {/* Waveform visualization */}
        <div style={recStyles.waveformContainer}>
          {analyserData.map((val, i) => (
            <div
              key={i}
              style={{
                width: 3,
                height: Math.max(4, val * 28),
                backgroundColor: showWarning ? '#f85149' : '#3fb950',
                borderRadius: 1.5,
                transition: 'height 0.1s ease',
                opacity: 0.6 + val * 0.4,
              }}
            />
          ))}
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={handleStop}
          style={recStyles.sendBtn}
          title="Send voice message"
          aria-label="Send voice message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
};

const recStyles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minHeight: 44,
  },
  requestingContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    width: '100%',
  },
  spinner: {
    width: 16,
    height: 16,
    border: '2px solid #30363d',
    borderTopColor: '#58a6ff',
    borderRadius: '50%',
    animation: 'frame-spin 0.8s linear infinite',
  },
  errorContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    width: '100%',
  },
  errorText: {
    color: '#f85149',
    fontSize: 13,
    flex: 1,
  },
  dismissBtn: {
    background: 'none',
    border: '1px solid #30363d',
    color: '#8b949e',
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
    flexShrink: 0,
  },
  recordingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '4px 4px',
  },
  cancelBtn: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    cursor: 'pointer',
    padding: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    flexShrink: 0,
    minWidth: 36,
    minHeight: 36,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: '#f85149',
    animation: 'frame-rec-pulse 1.2s ease-in-out infinite',
    flexShrink: 0,
  },
  timer: {
    fontFamily: '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',
    fontSize: 14,
    fontWeight: 600,
    minWidth: 36,
    flexShrink: 0,
  },
  warningText: {
    fontSize: 11,
    color: '#f85149',
    fontWeight: 600,
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },
  waveformContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    flex: 1,
    height: 32,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  sendBtn: {
    padding: '8px 14px',
    borderRadius: 18,
    border: 'none',
    backgroundColor: '#3fb950',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    minWidth: 44,
    minHeight: 36,
    transition: 'background-color 0.15s',
  },
};

export default VoiceRecorder;
