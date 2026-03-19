import React, { useRef, useState, useEffect, useCallback } from 'react';

interface CameraCaptureProps {
  /** Pre-acquired camera stream (acquired in click handler for user gesture chain) */
  stream: MediaStream;
  /** Called with the captured image File when user taps Send */
  onCapture: (file: File) => void;
  /** Called when user cancels or closes the camera */
  onClose: () => void;
}

/**
 * Full-screen camera capture modal for the F.R.A.M.E. E2EE messenger.
 * Shows a live preview, lets the user capture a photo, then review it
 * before sending. Matches the existing dark theme.
 */
const CameraCapture: React.FC<CameraCaptureProps> = ({ stream, onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [currentStream, setCurrentStream] = useState<MediaStream>(stream);
  const streamRef = useRef<MediaStream>(stream);
  const [isSwitching, setIsSwitching] = useState(false);

  // Keep streamRef in sync with currentStream
  useEffect(() => { streamRef.current = currentStream; }, [currentStream]);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (video && currentStream) {
      video.srcObject = currentStream;
    }
  }, [currentStream]);

  // Cleanup: stop all tracks when component unmounts
  useEffect(() => {
    return () => {
      streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Stop old stream and start new one when toggling cameras
  const toggleCamera = useCallback(async () => {
    if (isSwitching) return;
    setIsSwitching(true);
    const newFacing = facingMode === 'environment' ? 'user' : 'environment';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing },
      });
      // Stop old stream tracks
      currentStream.getTracks().forEach((t) => t.stop());
      setCurrentStream(newStream);
      setFacingMode(newFacing);
    } catch (err) {
      console.warn('[CameraCapture] Failed to switch camera:', err);
    } finally {
      setIsSwitching(false);
    }
  }, [facingMode, currentStream, isSwitching]);

  // Capture frame from video
  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
        // Pause stream while reviewing
        currentStream.getTracks().forEach((t) => { t.enabled = false; });
      },
      'image/jpeg',
      0.92,
    );
  }, [currentStream]);

  // Retake — resume stream
  const handleRetake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setCapturedBlob(null);
    setPreviewUrl(null);
    currentStream.getTracks().forEach((t) => { t.enabled = true; });
  }, [previewUrl, currentStream]);

  // Send — convert blob to File and pass to parent
  const handleSend = useCallback(() => {
    if (!capturedBlob) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([capturedBlob], `photo-${timestamp}.jpg`, {
      type: 'image/jpeg',
    });
    // Stop the stream before closing
    currentStream.getTracks().forEach((t) => t.stop());
    onCapture(file);
  }, [capturedBlob, currentStream, onCapture]);

  // Close — stop stream and close
  const handleClose = useCallback(() => {
    currentStream.getTracks().forEach((t) => t.stop());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  }, [currentStream, previewUrl, onClose]);

  return (
    <div style={overlayStyle}>
      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Close button */}
      <button type="button" onClick={handleClose} style={closeButtonStyle} aria-label="Close camera">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {previewUrl ? (
        /* ── Review captured image ── */
        <>
          <img src={previewUrl} alt="Captured" style={previewImageStyle} />
          <div style={reviewBarStyle}>
            <button type="button" onClick={handleRetake} style={retakeButtonStyle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              Retake
            </button>
            <button type="button" onClick={handleSend} style={sendButtonStyle}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Send
            </button>
          </div>
        </>
      ) : (
        /* ── Live preview ── */
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={videoStyle}
          />
          <div style={controlsBarStyle}>
            {/* Toggle front/back camera */}
            <button type="button" onClick={() => void toggleCamera()} disabled={isSwitching} style={flipButtonStyle} aria-label="Switch camera">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0l1.28-2.55a1 1 0 0 0-.9-1.45H3.62a1 1 0 0 0-.9 1.45L4 16" />
                <path d="M9 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
                <polyline points="15 4 18 1 21 4" />
                <line x1="18" y1="1" x2="18" y2="8" />
              </svg>
            </button>
            {/* Capture button — iOS-style circular */}
            <button type="button" onClick={handleCapture} style={captureButtonStyle} aria-label="Take photo">
              <div style={captureInnerStyle} />
            </button>
            {/* Spacer for centering */}
            <div style={{ width: 48 }} />
          </div>
        </>
      )}
    </div>
  );
};

/* ── Styles ── */

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: '#000',
  zIndex: 10000,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
};

const closeButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  background: 'rgba(0,0,0,0.5)',
  border: 'none',
  borderRadius: '50%',
  width: 44,
  height: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 10001,
};

const videoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

const previewImageStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'contain',
  backgroundColor: '#000',
};

const controlsBarStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  padding: '24px 0 40px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-around',
  background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
};

const captureButtonStyle: React.CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: '50%',
  border: '4px solid #fff',
  background: 'transparent',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
};

const captureInnerStyle: React.CSSProperties = {
  width: 58,
  height: 58,
  borderRadius: '50%',
  backgroundColor: '#fff',
  transition: 'transform 0.1s',
};

const flipButtonStyle: React.CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: '50%',
  background: 'rgba(255,255,255,0.2)',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const reviewBarStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 0,
  padding: '24px 32px 40px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
};

const retakeButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'rgba(255,255,255,0.15)',
  border: '1px solid rgba(255,255,255,0.3)',
  borderRadius: 24,
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  padding: '10px 20px',
  cursor: 'pointer',
};

const sendButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: '#238636',
  border: 'none',
  borderRadius: 24,
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  padding: '10px 24px',
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(35, 134, 54, 0.4)',
};

export default CameraCapture;
