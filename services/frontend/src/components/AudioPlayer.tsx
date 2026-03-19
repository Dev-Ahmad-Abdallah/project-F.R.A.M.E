import React, { useState, useRef, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  audioBase64: string;
  durationMs: number;
  isSent?: boolean;
  /** MIME type of the audio data (e.g. 'audio/webm;codecs=opus', 'audio/mp4'). Defaults to 'audio/webm'. */
  mimeType?: string;
  /** If true, the player can only be played once, then shows an expired message. */
  viewOnce?: boolean;
  /** Called after a view-once message finishes playing. */
  onConsumed?: () => void;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioBase64, durationMs, isSent, mimeType = 'audio/webm', viewOnce, onConsumed }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationMs / 1000);
  const [consumed, setConsumed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waveformBars] = useState<number[]>(() => {
    // Generate pseudo-random waveform bars based on the audio data hash
    const bars: number[] = [];
    let seed = 0;
    for (let i = 0; i < Math.min(audioBase64.length, 100); i++) {
      seed = (seed + audioBase64.charCodeAt(i)) % 1000;
    }
    for (let i = 0; i < 24; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      bars.push(0.2 + (seed % 100) / 125);
    }
    return bars;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanupInterval = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanupInterval();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [cleanupInterval]);

  // Create a stable Blob URL from the base64 data (avoids data-URI size limits)
  const blobUrlRef = useRef<string | null>(null);
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  const getAudioElement = useCallback((): HTMLAudioElement | null => {
    if (!audioRef.current) {
      let byteString: string;
      try {
        byteString = atob(audioBase64);
      } catch {
        setError('Audio data is corrupted');
        return null;
      }
      // Decode base64 to binary and create a Blob with the full MIME type (including codecs)
      const bytes = new Uint8Array(byteString.length);
      for (let i = 0; i < byteString.length; i++) {
        // eslint-disable-next-line security/detect-object-injection
        bytes[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        if (audio.duration && isFinite(audio.duration)) {
          setDuration(audio.duration);
        }
      });
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
        cleanupInterval();
        if (viewOnce && !consumed) {
          setConsumed(true);
          onConsumed?.();
        }
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [audioBase64, mimeType, cleanupInterval, viewOnce, consumed, onConsumed]);

  const togglePlay = useCallback(() => {
    const audio = getAudioElement();
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      cleanupInterval();
    } else {
      audio.play().then(() => {
        setIsPlaying(true);
        progressIntervalRef.current = setInterval(() => {
          setCurrentTime(audio.currentTime);
        }, 50);
      }).catch((err) => {
        console.warn('Audio playback failed:', err);
      });
    }
  }, [isPlaying, getAudioElement, cleanupInterval]);

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    const audio = getAudioElement();
    if (!audio) return;
    const seekTime = pct * duration;
    audio.currentTime = seekTime;
    setCurrentTime(seekTime);
    if (!isPlaying) {
      audio.play().then(() => {
        setIsPlaying(true);
        cleanupInterval();
        progressIntervalRef.current = setInterval(() => {
          setCurrentTime(audio.currentTime);
        }, 50);
      }).catch(() => undefined);
    }
  }, [duration, isPlaying, getAudioElement, cleanupInterval]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const activeColor = isSent ? 'rgba(255,255,255,0.95)' : '#79b8ff';
  const inactiveColor = isSent ? 'rgba(255,255,255,0.25)' : '#484f58';
  const btnBg = isSent ? 'rgba(255,255,255,0.15)' : 'rgba(88, 166, 255, 0.12)';
  const btnColor = isSent ? '#ffffff' : '#e6edf3';
  const timeColor = isSent ? 'rgba(255,255,255,0.55)' : '#8b949e';

  if (error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 0',
        width: '100%',
      }}>
        <span style={{ fontSize: 12, color: '#f85149' }}>&#9888;</span>
        <span style={{ fontStyle: 'italic', color: '#f85149', fontSize: 13 }}>{error}</span>
      </div>
    );
  }

  if (consumed) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 0',
        width: '100%',
      }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>&#128065;</span>
        <span style={{ fontStyle: 'italic', color: '#8b949e', fontSize: 13 }}>Voice message expired</span>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '4px 0',
      width: '100%',
      maxWidth: '100%',
      minWidth: 0,
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      {/* Play/Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: btnColor,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: '50%',
          backgroundColor: btnBg,
          transition: 'background-color 0.15s, transform 0.1s',
        }}
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
        onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)'; }}
        onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'; }}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,3 20,12 6,21" />
          </svg>
        )}
      </button>

      {/* Waveform progress bar */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          height: 32,
          cursor: 'pointer',
          position: 'relative',
          overflow: 'hidden',
          minWidth: 0,
        }}
        onClick={handleBarClick}
        role="slider"
        aria-label="Audio progress"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
      >
        {waveformBars.map((height, i) => {
          const barProgress = i / waveformBars.length;
          const isActive = barProgress <= progress;
          return (
            <div
              key={i}
              style={{
                width: 3,
                height: Math.max(4, height * 28),
                borderRadius: 1.5,
                backgroundColor: isActive ? activeColor : inactiveColor,
                transition: 'background-color 0.15s ease',
                flexShrink: 1,
              }}
            />
          );
        })}
      </div>

      {/* Duration / current time */}
      <span style={{
        fontFamily: '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',
        fontSize: 11,
        color: timeColor,
        flexShrink: 0,
        minWidth: 32,
        textAlign: 'right' as const,
      }}>
        {isPlaying || currentTime > 0 ? formatTime(currentTime) : formatTime(duration)}
      </span>
    </div>
  );
};

export default AudioPlayer;
