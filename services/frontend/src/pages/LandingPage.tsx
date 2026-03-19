/**
 * LandingPage — Marketing / splash page for F.R.A.M.E.
 *
 * Shown before authentication. Presents the value proposition,
 * trust signals, features, how-it-works flow, and security
 * architecture overview. All styles are inline; no external CSS
 * or images. SVG icons are inlined.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';

// ── Props ──

interface LandingPageProps {
  onGetStarted: () => void;
  onTryAsGuest?: () => void;
}

// ── Color tokens (shared with the rest of the app) ──

const C = {
  bg: '#0d1117',
  cardBg: '#161b22',
  darkerBg: '#0e1116',
  border: '#30363d',
  text: '#c9d1d9',
  textSecondary: '#9ea7b3',
  accent: '#58a6ff',
  success: '#3fb950',
  white: '#f0f6fc',
  font: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

// ── Scroll-triggered fade-in hook ──

function useScrollReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return { ref, visible };
}

// ── Animated counter hook ──

function useCountUp(target: number, duration = 1400, trigger = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) { setValue(0); return; }
    let start: number | null = null;
    let raf: number;
    const step = (ts: number) => {
      if (start === null) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, trigger]);
  return value;
}

// ── Typewriter hook ──

function useTypewriter(text: string, speed = 90, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let i = 0;
    const chars = text.split('');
    timeout = setTimeout(function tick() {
      if (i < chars.length) {
        setDisplayed(text.slice(0, i + 1));
        i++;
        timeout = setTimeout(tick, speed);
      }
    }, startDelay);
    return () => clearTimeout(timeout);
  }, [text, speed, startDelay]);
  return displayed;
}

// ── Inline SVG icons ──

const ShieldIcon = () => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M32 4L8 16v16c0 14.4 10.24 27.84 24 32 13.76-4.16 24-17.6 24-32V16L32 4z" stroke={C.accent} strokeWidth="2" fill="rgba(88,166,255,0.08)" />
    <path d="M26 32l4 4 8-8" stroke={C.success} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

const LockIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
    <rect x="10" y="20" width="28" height="22" rx="4" stroke={C.accent} strokeWidth="2" fill="rgba(88,166,255,0.06)" />
    <path d="M16 20v-6a8 8 0 1116 0v6" stroke={C.accent} strokeWidth="2" fill="none" strokeLinecap="round" />
    <circle cx="24" cy="31" r="3" fill={C.accent} />
    <path d="M24 34v4" stroke={C.accent} strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ServerIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <rect x="6" y="6" width="28" height="10" rx="3" stroke={C.textSecondary} strokeWidth="1.5" fill="rgba(139,148,158,0.06)" />
    <rect x="6" y="24" width="28" height="10" rx="3" stroke={C.textSecondary} strokeWidth="1.5" fill="rgba(139,148,158,0.06)" />
    <circle cx="12" cy="11" r="1.5" fill={C.success} />
    <circle cx="12" cy="29" r="1.5" fill={C.success} />
    <line x1="20" y1="16" x2="20" y2="24" stroke={C.textSecondary} strokeWidth="1.5" />
  </svg>
);

const NetworkIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="8" r="4" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
    <circle cx="8" cy="32" r="4" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
    <circle cx="32" cy="32" r="4" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
    <line x1="20" y1="12" x2="8" y2="28" stroke={C.accent} strokeWidth="1.5" />
    <line x1="20" y1="12" x2="32" y2="28" stroke={C.accent} strokeWidth="1.5" />
    <line x1="8" y1="32" x2="32" y2="32" stroke={C.accent} strokeWidth="1.5" />
  </svg>
);

const ZeroTrustIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 4L6 12v10c0 10.8 5.97 20.88 14 24 8.03-3.12 14-13.2 14-24V12L20 4z" stroke={C.success} strokeWidth="1.5" fill="rgba(63,185,80,0.06)" />
    <path d="M15 20l3 3 7-7" stroke={C.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BellIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M20 6c-5.52 0-10 4.48-10 10v8l-2 4h24l-2-4v-8c0-5.52-4.48-10-10-10z" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.06)" />
    <path d="M16 28a4 4 0 008 0" stroke={C.accent} strokeWidth="1.5" fill="none" />
    <circle cx="20" cy="6" r="2" fill={C.accent} />
  </svg>
);

const DevicesIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <rect x="4" y="8" width="20" height="14" rx="2" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.06)" />
    <rect x="22" y="14" width="14" height="20" rx="2" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.06)" />
    <line x1="4" y1="18" x2="24" y2="18" stroke={C.accent} strokeWidth="1" />
    <circle cx="29" cy="31" r="1.5" fill={C.accent} />
  </svg>
);

const CodeIcon = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
    <path d="M14 12l-8 8 8 8" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M26 12l8 8-8 8" stroke={C.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="22" y1="8" x2="18" y2="32" stroke={C.textSecondary} strokeWidth="1.5" />
  </svg>
);

const EncryptedIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="5" y="10" width="14" height="10" rx="2" stroke={C.success} strokeWidth="1.5" fill="rgba(63,185,80,0.1)" />
    <path d="M8 10V7a4 4 0 118 0v3" stroke={C.success} strokeWidth="1.5" fill="none" />
  </svg>
);

const OpenSourceIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.08)" />
    <path d="M8 14a4 4 0 018 0" stroke={C.accent} strokeWidth="1.5" fill="none" />
    <circle cx="12" cy="10" r="2" fill={C.accent} />
  </svg>
);

const ZeroKnowledgeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M12 3L4 7v5c0 5.55 3.41 10.74 8 12 4.59-1.26 8-6.45 8-12V7l-8-4z" stroke={C.success} strokeWidth="1.5" fill="rgba(63,185,80,0.08)" />
    <path d="M9 12l2 2 4-4" stroke={C.success} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const FederatedIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="5" r="2.5" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
    <circle cx="5" cy="19" r="2.5" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
    <circle cx="19" cy="19" r="2.5" stroke={C.accent} strokeWidth="1.5" fill="rgba(88,166,255,0.1)" />
    <line x1="12" y1="7.5" x2="5" y2="16.5" stroke={C.accent} strokeWidth="1" />
    <line x1="12" y1="7.5" x2="19" y2="16.5" stroke={C.accent} strokeWidth="1" />
    <line x1="5" y1="19" x2="19" y2="19" stroke={C.accent} strokeWidth="1" />
  </svg>
);

// ── Keyframes injected via <style> ──

const keyframesCSS = `
@keyframes frame-gradient-shift {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes frame-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-12px); }
}
@keyframes frame-fade-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes frame-pulse-border {
  0%, 100% { border-color: #30363d; }
  50% { border-color: #58a6ff40; }
}
@keyframes frame-flow-line {
  0% { stroke-dashoffset: 100; }
  100% { stroke-dashoffset: 0; }
}
@keyframes frame-cta-pulse {
  0%, 100% {
    box-shadow: 0 0 20px rgba(88,166,255,0.25), 0 0 0 0 rgba(88,166,255,0.4);
  }
  50% {
    box-shadow: 0 0 20px rgba(88,166,255,0.35), 0 0 0 8px rgba(88,166,255,0);
  }
}
@keyframes frame-glow-hover {
  0%, 100% { box-shadow: 0 0 0 0 rgba(88,166,255,0); }
  50% { box-shadow: 0 0 20px 2px rgba(88,166,255,0.15); }
}
@keyframes frame-data-flow {
  0% { stroke-dashoffset: 20; }
  100% { stroke-dashoffset: 0; }
}
@keyframes frame-typewriter-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes frame-scroll-reveal {
  from { opacity: 0; transform: translateY(32px); }
  to { opacity: 1; transform: translateY(0); }
}
html { scroll-behavior: smooth; }
@keyframes frame-menu-slide-down {
  0% { opacity: 0; transform: translateY(-8px); }
  100% { opacity: 1; transform: translateY(0); }
}
`;

// ── Mobile hamburger menu ──

function MobileMenu({ scrollTo }: { scrollTo: (id: string) => void }) {
  const [open, setOpen] = useState(false);

  const handleNav = (id: string) => {
    scrollTo(id);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 8,
          minWidth: 44,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" stroke={C.text} strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 8,
          backgroundColor: C.cardBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: 8,
          minWidth: 180,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          zIndex: 200,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          animation: 'frame-menu-slide-down 0.2s ease-out',
        }}>
          {['features', 'how-it-works', 'security'].map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => handleNav(id)}
              style={{
                background: 'none',
                border: 'none',
                color: C.text,
                fontSize: 14,
                padding: '10px 16px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: C.font,
                borderRadius: 6,
                minHeight: 44,
              }}
            >
              {id === 'how-it-works' ? 'How It Works' : id.charAt(0).toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Scroll-reveal wrapper ──

function ScrollReveal({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const { ref, visible } = useScrollReveal(0.12);
  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(32px)',
        transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Component ──

export default function LandingPage({ onGetStarted, onTryAsGuest }: LandingPageProps) {
  // Layout and sizing handled by fluid CSS classes (frame-hero-title,
  // frame-section-title, frame-feature-grid, etc.) — no JS breakpoint needed.
  // Hamburger menu visibility is handled by CSS media queries
  // (.frame-mobile-menu / .frame-desktop-nav).

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  // ── Typewriter for hero subtitle ──
  const subtitleText = 'F.R.A.M.E. is a federated end-to-end encrypted messenger where the server never sees your messages.';
  const typedSubtitle = useTypewriter(subtitleText, 30, 800);

  // ── Trust signal counter trigger ──
  const trustRef = useScrollReveal(0.3);

  // ── Counter animations for trust signals ──
  const count256 = useCountUp(256, 1600, trustRef.visible);
  const count100 = useCountUp(100, 1400, trustRef.visible);

  // ── Trust signal data ──
  const trustSignals = [
    { icon: <EncryptedIcon />, label: 'End-to-End Encrypted', countLabel: `${count256}-bit Encryption` },
    { icon: <OpenSourceIcon />, label: `${count100}% Open Source` },
    { icon: <ZeroKnowledgeIcon />, label: 'Zero Knowledge Server' },
    { icon: <FederatedIcon />, label: 'Federated' },
  ];

  // ── Features data ──
  const features = [
    {
      icon: <LockIcon />,
      title: 'Military-Grade Encryption',
      desc: 'Olm/Megolm Double Ratchet protocol with forward secrecy and post-compromise security. Every message uses a unique key.',
    },
    {
      icon: <NetworkIcon />,
      title: 'Federated Architecture',
      desc: 'No single point of failure. Choose your homeserver or run your own. Seamless cross-server messaging.',
    },
    {
      icon: <ZeroTrustIcon />,
      title: 'Zero Trust Server',
      desc: 'The server never decrypts your messages. All cryptographic operations happen on your device. Key transparency verification built in.',
    },
    {
      icon: <BellIcon />,
      title: 'Secure Notifications',
      desc: 'No metadata in push notifications. Opaque payloads only. Decryption happens locally on your device after receipt.',
    },
    {
      icon: <DevicesIcon />,
      title: 'Multi-Device Security',
      desc: 'QR-based device linking with cross-signing. Per-device encryption keys. Instant alerts for unknown devices.',
    },
    {
      icon: <CodeIcon />,
      title: 'XSS-Proof Interface',
      desc: 'DOMPurify sanitization on all rendered content. Strict Content Security Policy. Zero use of innerHTML.',
    },
  ];

  // ── How it works ──
  const steps = [
    {
      num: '1',
      title: 'Sign Up',
      desc: 'Create your account on any F.R.A.M.E.-compatible homeserver.',
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="16" cy="12" r="5" stroke={C.accent} strokeWidth="1.5" fill="none" />
          <path d="M8 26c0-4.42 3.58-8 8-8s8 3.58 8 8" stroke={C.accent} strokeWidth="1.5" fill="none" />
        </svg>
      ),
    },
    {
      num: '2',
      title: 'Generate Keys',
      desc: 'Your device generates Ed25519 + Curve25519 key pairs locally. Keys never leave your device.',
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <circle cx="12" cy="16" r="6" stroke={C.success} strokeWidth="1.5" fill="none" />
          <path d="M18 16h8M22 12v8" stroke={C.success} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      num: '3',
      title: 'Start Messaging',
      desc: 'Send end-to-end encrypted messages. Only you and the recipient can read them.',
      icon: (
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <path d="M6 8h20v14a2 2 0 01-2 2H8a2 2 0 01-2-2V8z" stroke={C.accent} strokeWidth="1.5" fill="none" />
          <path d="M6 8l10 8 10-8" stroke={C.accent} strokeWidth="1.5" fill="none" />
        </svg>
      ),
    },
  ];

  // ── Feature card hover handlers ──
  const handleCardEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.style.borderColor = C.accent + '60';
    el.style.transform = 'translateY(-4px)';
    el.style.boxShadow = `0 0 24px 4px rgba(88,166,255,0.12), 0 4px 16px rgba(0,0,0,0.3)`;
  }, []);

  const handleCardLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.style.borderColor = C.border;
    el.style.transform = 'translateY(0)';
    el.style.boxShadow = 'none';
  }, []);

  return (
    <>
      <style>{keyframesCSS}</style>
      <div style={{
        minHeight: '100vh',
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: C.font,
        overflowX: 'hidden',
      }}>
        {/* ─── Nav Bar ─── */}
        <nav className="frame-landing-nav" style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'rgba(13,17,23,0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{
            fontSize: 20,
            fontWeight: 700,
            color: C.white,
            letterSpacing: 2,
          }}>
            F.R.A.M.E.
          </span>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="frame-desktop-nav" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button type="button" onClick={() => scrollTo('features')} style={navLink}>Features</button>
              <button type="button" onClick={() => scrollTo('how-it-works')} style={navLink}>How It Works</button>
              <button type="button" onClick={() => scrollTo('security')} style={navLink}>Security</button>
            </div>
            <div className="frame-mobile-menu">
              <MobileMenu scrollTo={scrollTo} />
            </div>
            <button type="button" onClick={onGetStarted} style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              backgroundColor: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: C.font,
              minHeight: 44,
            }}>
              Sign In
            </button>
          </div>
        </nav>

        {/* ─── Hero ─── */}
        <section className="frame-landing-hero" style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
        }}>
          {/* Animated gradient background */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(ellipse 80% 60% at 50% 40%, rgba(88,166,255,0.08) 0%, transparent 70%), radial-gradient(ellipse 60% 50% at 30% 80%, rgba(63,185,80,0.05) 0%, transparent 70%)',
            animation: 'frame-gradient-shift 12s ease infinite',
            backgroundSize: '200% 200%',
            pointerEvents: 'none',
          }} />

          {/* Subtle grid pattern */}
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(${C.border}22 1px, transparent 1px), linear-gradient(90deg, ${C.border}22 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            pointerEvents: 'none',
            opacity: 0.5,
          }} />

          {/* Shield icon with float animation */}
          <div style={{ animation: 'frame-float 4s ease-in-out infinite', marginBottom: 24, position: 'relative', zIndex: 1 }}>
            <ShieldIcon />
          </div>

          {/* Enhancement #8: Gradient text on headline */}
          <h1 className="frame-hero-title" style={{
            margin: 0,
            background: 'linear-gradient(135deg, #58a6ff 0%, #c9d1d9 40%, #f0f6fc 60%, #58a6ff 100%)',
            backgroundSize: '200% 200%',
            animation: 'frame-gradient-shift 6s ease infinite, frame-fade-in 0.8s ease-out',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            position: 'relative',
            zIndex: 1,
          }}>
            Your messages. Your keys.<br />Your privacy.
          </h1>

          {/* Enhancement #1: Typewriter subtitle */}
          <p className="frame-hero-subtitle" style={{
            margin: '20px 0 0',
            color: C.textSecondary,
            position: 'relative',
            zIndex: 1,
            minHeight: 30,
          }}>
            {typedSubtitle}
            <span style={{
              display: 'inline-block',
              width: 2,
              height: '1em',
              backgroundColor: C.accent,
              marginLeft: 2,
              verticalAlign: 'text-bottom',
              animation: 'frame-typewriter-cursor 0.8s step-end infinite',
              opacity: typedSubtitle.length < subtitleText.length ? 1 : 0,
              transition: 'opacity 0.3s',
            }} />
          </p>

          <div style={{
            display: 'flex',
            flexDirection: 'row',
            gap: 16,
            marginTop: 36,
            position: 'relative',
            zIndex: 1,
            animation: 'frame-fade-in 0.8s ease-out 0.3s both',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}>
            {/* Enhancement #5: Pulsing CTA button */}
            <button type="button" onClick={onGetStarted} style={{
              padding: '14px 36px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: C.font,
              transition: 'transform 0.15s',
              animation: 'frame-cta-pulse 2.5s ease-in-out infinite',
              minHeight: 48,
            }}>
              Get Started
            </button>
            <button type="button" onClick={() => scrollTo('features')} style={{
              padding: '14px 36px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: 'transparent',
              color: C.accent,
              border: `1px solid ${C.accent}`,
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: C.font,
              transition: 'background-color 0.15s',
              minHeight: 48,
            }}>
              Learn More
            </button>
          </div>
          {onTryAsGuest && (
            <button
              type="button"
              onClick={onTryAsGuest}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                color: C.textSecondary,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: C.font,
                textDecoration: 'underline',
                textUnderlineOffset: 3,
                position: 'relative',
                zIndex: 1,
                animation: 'frame-fade-in 0.8s ease-out 0.5s both',
              }}
            >
              Try as Guest -- no account needed
            </button>
          )}
        </section>

        {/* ─── Trust Signals Bar ─── */}
        {/* Enhancement #3: Counter animation on trust signals */}
        <section
          ref={trustRef.ref}
          className="frame-trust-signals"
          style={{
            borderBottom: `1px solid ${C.border}`,
            backgroundColor: C.darkerBg,
          }}
        >
          {trustSignals.map((s, i) => (
            <div key={i} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: trustRef.visible ? 0.9 : 0,
              transform: trustRef.visible ? 'translateY(0)' : 'translateY(12px)',
              transition: `opacity 0.5s ease ${i * 120}ms, transform 0.5s ease ${i * 120}ms`,
            }}>
              {s.icon}
              <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {s.countLabel || s.label}
              </span>
            </div>
          ))}
        </section>

        {/* ─── Features ─── */}
        <section id="features" className="frame-landing-section" style={{
          maxWidth: 1120,
          margin: '0 auto',
        }}>
          <ScrollReveal>
            <h2 className="frame-section-title" style={{
              textAlign: 'center',
              color: C.white,
              margin: '0 0 12px',
            }}>
              Security by Design
            </h2>
            <p style={{
              textAlign: 'center',
              fontSize: 16,
              color: C.textSecondary,
              margin: '0 auto 48px',
              maxWidth: 520,
            }}>
              Every layer of F.R.A.M.E. is built to protect your conversations.
            </p>
          </ScrollReveal>
          {/* Enhancement #2: Staggered fade-in + Enhancement #4: Hover glow */}
          <div className="frame-feature-grid">
            {features.map((f, i) => (
              <ScrollReveal key={f.title} delay={i * 100}>
                <div
                  style={{
                    backgroundColor: C.cardBg,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 28,
                    transition: 'border-color 0.3s, transform 0.3s, box-shadow 0.3s',
                    cursor: 'default',
                    height: '100%',
                  }}
                  onMouseEnter={handleCardEnter}
                  onMouseLeave={handleCardLeave}
                >
                  <div style={{ marginBottom: 16 }}>{f.icon}</div>
                  <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: C.white }}>{f.title}</h3>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.textSecondary }}>{f.desc}</p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </section>

        {/* ─── How It Works ─── */}
        <section id="how-it-works" className="frame-landing-section" style={{
          backgroundColor: C.darkerBg,
        }}>
          <ScrollReveal>
            <h2 className="frame-section-title" style={{
              textAlign: 'center',
              color: C.white,
              margin: '0 0 12px',
            }}>
              How It Works
            </h2>
            <p style={{
              textAlign: 'center',
              fontSize: 16,
              color: C.textSecondary,
              margin: '0 auto 56px',
              maxWidth: 480,
            }}>
              Get up and running in three simple steps.
            </p>
          </ScrollReveal>
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 0,
            maxWidth: 900,
            margin: '0 auto',
            alignItems: 'stretch',
            justifyContent: 'center',
          }}>
            {steps.map((step, i) => (
              <React.Fragment key={step.num}>
                <ScrollReveal delay={i * 200}>
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    padding: '0 20px',
                  }}>
                    <div style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      backgroundColor: C.cardBg,
                      border: `2px solid ${C.accent}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                      position: 'relative',
                    }}>
                      <span style={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        backgroundColor: C.accent,
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        {step.num}
                      </span>
                      {step.icon}
                    </div>
                    <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: C.white }}>{step.title}</h3>
                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.textSecondary, maxWidth: 220 }}>{step.desc}</p>
                  </div>
                </ScrollReveal>
                {/* Connector line between steps (desktop only) — Enhancement #7 partial: animated dashes */}
                {i < steps.length - 1 && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    paddingBottom: 60,
                  }}>
                    <svg width="40" height="2" viewBox="0 0 40 2">
                      <line
                        x1="0" y1="1" x2="40" y2="1"
                        stroke={C.accent}
                        strokeWidth="2"
                        strokeDasharray="6 4"
                        style={{ animation: 'frame-data-flow 1.5s linear infinite' }}
                      />
                    </svg>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </section>

        {/* ─── Security Architecture ─── */}
        <section id="security" className="frame-landing-section" style={{
          maxWidth: 800,
          margin: '0 auto',
        }}>
          <ScrollReveal>
            <h2 className="frame-section-title" style={{
              textAlign: 'center',
              color: C.white,
              margin: '0 0 12px',
            }}>
              Security Architecture
            </h2>
            <p style={{
              textAlign: 'center',
              fontSize: 16,
              color: C.textSecondary,
              margin: '0 auto 48px',
              maxWidth: 520,
            }}>
              The server is an untrusted relay. All encryption happens on YOUR device.
            </p>
          </ScrollReveal>

          {/* Architecture diagram — Enhancement #7: animated data flow lines */}
          <ScrollReveal delay={150}>
            <div style={{
              backgroundColor: C.cardBg,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 'clamp(20px, 3vw, 40px)',
              textAlign: 'center',
            }}>
              <div style={{
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0,
              }}>
                {/* Client A */}
                <div style={archBox(true)}>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <rect x="4" y="4" width="20" height="16" rx="2" stroke={C.success} strokeWidth="1.5" fill="none" />
                    <line x1="10" y1="20" x2="18" y2="20" stroke={C.success} strokeWidth="1.5" />
                    <line x1="14" y1="20" x2="14" y2="24" stroke={C.success} strokeWidth="1.5" />
                    <line x1="10" y1="24" x2="18" y2="24" stroke={C.success} strokeWidth="1.5" />
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.success }}>Your Device</span>
                  <span style={{ fontSize: 11, color: C.textSecondary }}>Trusted</span>
                </div>

                {/* Animated flow arrow */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8px' }}>
                  <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginBottom: 4 }}>ENCRYPTED</span>
                  <svg width="60" height="6" viewBox="0 0 60 6" style={{ overflow: 'visible' }}>
                    <line x1="0" y1="3" x2="60" y2="3" stroke={C.accent} strokeWidth="2" strokeDasharray="4 3" style={{ animation: 'frame-data-flow 1.2s linear infinite' }} />
                    <polygon points="55,0 60,3 55,6" fill={C.accent} opacity="0.7" />
                  </svg>
                </div>

                {/* Server */}
                <div style={{
                  ...archBox(false),
                  animation: 'frame-pulse-border 3s ease-in-out infinite',
                }}>
                  <ServerIcon />
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.textSecondary }}>Server</span>
                  <span style={{ fontSize: 11, color: '#f8514966' }}>Untrusted Relay</span>
                </div>

                {/* Animated flow arrow */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 8px' }}>
                  <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, marginBottom: 4 }}>ENCRYPTED</span>
                  <svg width="60" height="6" viewBox="0 0 60 6" style={{ overflow: 'visible' }}>
                    <line x1="0" y1="3" x2="60" y2="3" stroke={C.accent} strokeWidth="2" strokeDasharray="4 3" style={{ animation: 'frame-data-flow 1.2s linear infinite' }} />
                    <polygon points="55,0 60,3 55,6" fill={C.accent} opacity="0.7" />
                  </svg>
                </div>

                {/* Client B */}
                <div style={archBox(true)}>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                    <rect x="6" y="2" width="16" height="24" rx="3" stroke={C.success} strokeWidth="1.5" fill="none" />
                    <circle cx="14" cy="22" r="1.5" fill={C.success} />
                    <line x1="10" y1="4" x2="18" y2="4" stroke={C.success} strokeWidth="1" />
                  </svg>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.success }}>Recipient</span>
                  <span style={{ fontSize: 11, color: C.textSecondary }}>Trusted</span>
                </div>
              </div>

              <p style={{
                margin: '32px auto 0',
                fontSize: 14,
                lineHeight: 1.7,
                color: C.textSecondary,
                maxWidth: 480,
              }}>
                Messages are encrypted on your device before being sent.
                The server stores and relays ciphertext it cannot decrypt.
                Only the intended recipient&apos;s device holds the keys to read your messages.
              </p>
            </div>
          </ScrollReveal>
        </section>

        {/* ─── CTA Banner ─── */}
        <section className="frame-landing-section" style={{
          backgroundColor: C.darkerBg,
          textAlign: 'center',
          borderTop: `1px solid ${C.border}`,
        }}>
          <ScrollReveal>
            <h2 className="frame-section-title" style={{
              margin: 0,
              color: C.white,
            }}>
              Ready for private messaging?
            </h2>
            <p style={{
              margin: '12px 0 32px',
              fontSize: 16,
              color: C.textSecondary,
            }}>
              Join F.R.A.M.E. and take control of your conversations.
            </p>
            {/* Enhancement #5: Pulsing CTA (bottom) */}
            <button type="button" onClick={onGetStarted} style={{
              padding: '14px 48px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: C.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontFamily: C.font,
              animation: 'frame-cta-pulse 2.5s ease-in-out infinite',
              minHeight: 48,
            }}>
              Get Started
            </button>
          </ScrollReveal>
        </section>

        {/* ─── Footer ─── */}
        <footer style={{
          padding: 'clamp(24px, 4vw, 40px) clamp(16px, 4vw, 48px)',
          borderTop: `1px solid ${C.border}`,
          backgroundColor: C.bg,
          textAlign: 'center',
        }}>
          <p style={{
            margin: '0 0 16px',
            fontSize: 13,
            color: C.textSecondary,
          }}>
            Built with vodozemac &middot; Olm/Megolm Protocol &middot; TypeScript &middot; Open Source
          </p>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            flexWrap: 'wrap',
            marginBottom: 20,
          }}>
            <button type="button" onClick={onGetStarted} style={footerLink}>Sign In</button>
            <button type="button" onClick={onGetStarted} style={footerLink}>Register</button>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" style={{ ...footerLink, textDecoration: 'none' }}>GitHub</a>
            <a href="#" style={{ ...footerLink, textDecoration: 'none' }}>Documentation</a>
          </div>
          <p style={{
            margin: 0,
            fontSize: 12,
            color: '#8b949e',
          }}>
            &copy; {new Date().getFullYear()} F.R.A.M.E. &mdash; Federated, Resilient, Authenticated Messaging with Encryption
          </p>
        </footer>
      </div>
    </>
  );
}

// ── Shared inline style fragments ──

const navLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.textSecondary,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: C.font,
  padding: '4px 8px',
  transition: 'color 0.15s',
};

const footerLink: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: C.accent,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: C.font,
  padding: 0,
};

function archBox(trusted: boolean): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '16px 20px',
    backgroundColor: trusted ? 'rgba(63,185,80,0.04)' : 'rgba(139,148,158,0.04)',
    border: `1px solid ${trusted ? C.success + '40' : C.border}`,
    borderRadius: 10,
    minWidth: 110,
  };
}
