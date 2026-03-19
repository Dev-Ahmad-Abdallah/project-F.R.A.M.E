import React, { useState, useRef, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  audioBase64: string;
  durationMs: number;
  isSent?: boolean;
  /** MIME type of the audio data (e.g. 'audio/webm;codecs=opus', 'audio/mp4'). Defaults to 'audio/webm'. */
  mimeType?: string;
}

const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioBase64, durationMs, isSent, mimeType = 'audio/webm' }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationMs / 1000);
  const [waveformBars] = useState<number[]>(() => {
    // Generate pseudo-random waveform bars based on the audio data hash
    const bars: number[] = [];
    let seed = 0;
    for (let i = 0; i < Math.min(audioBase64.length, 100); i++) {
      seed = (seed + audioBase64.charCodeAt(i)) % 1000;
    }
    for (let i = 0; i < 32; i++) {
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

  const getAudioElement = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      // Use the actual MIME type from recording (e.g. 'audio/mp4' on Safari)
      const dataUriMime = mimeType.split(';')[0] || 'audio/webm';
      const audio = new Audio(`data:${dataUriMime};base64,${audioBase64}`);
      audio.addEventListener('loadedmetadata', () => {
        if (audio.duration && isFinite(audio.duration)) {
          setDuration(audio.duration);
        }
      });
      audio.addEventListener('ended', () => {
        setIsPlaying(false);
        setCurrentTime(0);
        cleanupInterval();
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [audioBase64, mimeType, cleanupInterval]);

  const togglePlay = useCallback(() => {
    const audio = getAudioElement();

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
  const bgColor = isSent ? 'transparent' : '#21262d';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      borderRadius: 12,
      backgroundColor: bgColor,
      minWidth: 200,
      maxWidth: 320,
    }}>
      {/* Play/Pause button */}
      <button
        type="button"
        onClick={togglePlay}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: '#e6edf3',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: '50%',
          backgroundColor: 'rgba(88, 166, 255, 0.15)',
          transition: 'background-color 0.15s',
        }}
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>

      {/* Waveform progress bar */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          height: 28,
          cursor: 'pointer',
          position: 'relative',
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
                height: Math.max(4, height * 24),
                borderRadius: 1.5,
                backgroundColor: isActive ? '#58a6ff' : '#484f58',
                transition: 'background-color 0.15s',
                flexShrink: 0,
              }}
            />
          );
        })}
      </div>

      {/* Duration / current time */}
      <span style={{
        fontFamily: '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", monospace',
        fontSize: 11,
        color: '#8b949e',
        flexShrink: 0,
        minWidth: 30,
        textAlign: 'right' as const,
      }}>
        {isPlaying || currentTime > 0 ? formatTime(currentTime) : formatTime(duration)}
      </span>
    </div>
  );
};

export default AudioPlayer;
