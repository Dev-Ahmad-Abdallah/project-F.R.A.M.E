/**
 * Global CSS styles for Project F.R.A.M.E.
 *
 * Injects a single <style> tag into the document head with shared
 * hover, focus, scrollbar, animation, and base styles.
 */

export const FONT_BODY = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
export const FONT_MONO = '"SF Mono", "Fira Code", "Cascadia Code", monospace';

const GLOBAL_STYLE_ID = 'frame-global-styles';

const GLOBAL_CSS = `
/* ── Base reset: fill viewport, no whitespace ── */
html, body, #root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* ── Base typography ── */
body {
  font-size: 14px;
  line-height: 1.5;
}
small, .frame-text-sm { font-size: 12px; line-height: 1.4; }
h1, .frame-h1 { font-size: 18px; font-weight: 700; }
h2, .frame-h2 { font-size: 16px; font-weight: 600; }
h3, .frame-h3 { font-size: 14px; font-weight: 600; }

/* ── Smooth transitions on ALL interactive elements ── */
button, a, [role="button"], .frame-interactive,
input, textarea, select {
  transition: background-color 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
}

/* Hover states */
button:hover:not(:disabled) { filter: brightness(1.1); }
button:active:not(:disabled) { filter: brightness(0.95); transform: scale(0.98); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

/* Smooth sidebar collapse/expand */
.frame-sidebar { transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }

/* Dialog/modal smooth open/close */
@keyframes frame-dialog-enter {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes frame-dialog-backdrop-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}
.frame-dialog-enter { animation: frame-dialog-enter 0.25s cubic-bezier(0.32, 0.72, 0, 1) forwards; }
.frame-dialog-backdrop-enter { animation: frame-dialog-backdrop-enter 0.2s ease-out forwards; }

/* Focus visible — consistent green ring on all focusable elements */
button:focus-visible, a:focus-visible, input:focus-visible,
textarea:focus-visible, select:focus-visible, [role="button"]:focus-visible,
[tabindex]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #3fb950;
}

/* Input focus: clean border transition */
input:focus, textarea:focus, select:focus {
  border-color: #3fb950;
  outline: none;
}

/* Input placeholder */
input::placeholder { color: #8b949e; }

/* Selection color: green-tinted highlight */
::selection {
  background: rgba(63, 185, 80, 0.25);
  color: #f0f6fc;
}
::-moz-selection {
  background: rgba(63, 185, 80, 0.25);
  color: #f0f6fc;
}

/* Scrollbar styling for dark theme — thin, precise */
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: #0d1117; }
::-webkit-scrollbar-thumb { background: #21262d; border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: #30363d; }

/* Firefox thin scrollbar */
* {
  scrollbar-width: thin;
  scrollbar-color: #21262d #0d1117;
}

/* Military/tactical: green caret color on inputs */
input, textarea {
  caret-color: #3fb950;
}

/* Military/tactical: monospace placeholder on chat textarea */
.frame-chat-textarea::placeholder {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;
  letter-spacing: 0.03em;
  opacity: 0.5;
}

/* Vignette effect on chat message area */
.frame-chat-vignette {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 1;
  box-shadow: inset 0 0 80px 20px rgba(0, 0, 0, 0.35);
}

/* Modal entrance animation — slide-up with proper easing */
@keyframes frame-modal-enter {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}

/* Subtle scan-line effect for sidebar HUD feel */
@keyframes frame-scanline {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}

/* CRT glitch effect for security events */
@keyframes frame-glitch {
  0%, 100% { transform: translate(0); filter: none; clip-path: none; }
  10% { transform: translate(-2px, 1px); filter: hue-rotate(90deg); }
  20% { transform: translate(2px, -1px); filter: hue-rotate(-90deg) saturate(2); }
  30% { transform: translate(-1px, 2px); clip-path: inset(30% 0 40% 0); }
  40% { transform: translate(1px, -2px); clip-path: inset(60% 0 10% 0); }
  50% { transform: translate(0); filter: none; clip-path: none; }
}

@keyframes frame-rec-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

@keyframes frame-scanline-sweep {
  0% { top: -2px; }
  100% { top: 100vh; }
}

/* Precision font weight for UI labels */
button, label, [role="button"] {
  font-weight: 500;
}

/* Box sizing */
* { box-sizing: border-box; }

/* ── Fluid Responsive Design ── */

/* Sidebar: fluid width, overlay below 600px */
@keyframes frame-sidebar-slide-in {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.frame-sidebar {
  width: 320px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  background-color: #161b22;
  border-right: 1px solid #21262d;
  height: 100%;
  overflow: hidden;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1), transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border-top: 2px solid #3fb950;
}

/* Below 600px: sidebar becomes a Telegram-style slide-over overlay */
@media (max-width: 600px) {
  .frame-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 85vw;
    min-width: 85vw;
    max-width: 340px;
    z-index: 200;
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.5);
    transform: translateX(0);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform;
  }
  .frame-sidebar-hidden {
    transform: translateX(-100%) !important;
    pointer-events: none;
    box-shadow: none;
  }
  .frame-sidebar-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 199;
    opacity: 1;
    transition: opacity 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    -webkit-tap-highlight-color: transparent;
  }
  .frame-sidebar-backdrop-hidden {
    opacity: 0;
    pointer-events: none;
  }

  /* User info section: compact avatar (36px) */
  .frame-sidebar .frame-user-info {
    padding: 10px 12px 8px !important;
    gap: 8px !important;
  }
  .frame-sidebar .frame-user-avatar {
    width: 36px !important;
    height: 36px !important;
    font-size: 15px !important;
  }
  .frame-sidebar .frame-user-avatar-inner {
    width: 32px !important;
    height: 32px !important;
  }
  .frame-sidebar .frame-user-name {
    font-size: 12px !important;
  }
  .frame-sidebar .frame-user-status {
    font-size: 10px !important;
  }
  .frame-sidebar .frame-user-device {
    display: none !important;
  }

  /* Bottom actions: fixed tab bar, evenly spaced */
  .frame-sidebar-actions-mobile {
    display: flex !important;
    position: sticky;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: #161b22;
    border-top: 1px solid #30363d;
    padding: 0 !important;
    gap: 0 !important;
    z-index: 10;
  }
  .frame-sidebar-actions-mobile > button {
    flex: 1 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 2px !important;
    padding: 8px 4px !important;
    min-height: 52px !important;
    border: none !important;
    border-radius: 0 !important;
    background-color: transparent !important;
    color: #8b949e !important;
    font-size: 10px !important;
    font-weight: 500 !important;
    font-family: inherit !important;
    cursor: pointer !important;
    -webkit-tap-highlight-color: transparent;
  }
  .frame-sidebar-actions-mobile > button:active {
    background-color: rgba(88,166,255,0.08) !important;
  }
  .frame-sidebar-actions-mobile > button.frame-tab-active {
    color: #58a6ff !important;
  }

  /* Hide "?" keyboard shortcuts button on mobile */
  .frame-shortcuts-btn {
    display: none !important;
  }

  /* Hide sidebar footer branding on mobile to save space */
  .frame-sidebar-footer {
    display: none !important;
  }

  /* Session warning banner: compact on mobile */
  .frame-session-warning {
    padding: 4px 8px !important;
    font-size: 11px !important;
  }

  /* Guest banner: compact on mobile */
  .frame-guest-banner {
    padding: 6px 10px !important;
    font-size: 12px !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
    justify-content: center !important;
  }
  .frame-guest-banner > span {
    font-size: 12px !important;
    text-align: center !important;
  }

  /* Connection lost: thin strip */
  .frame-connection-banner {
    padding: 3px 8px !important;
    font-size: 11px !important;
  }

  /* Lock screen: mobile-friendly */
  .frame-lock-card {
    padding: 24px 20px !important;
    width: 92% !important;
    max-width: 340px !important;
  }
  .frame-lock-input {
    padding: 12px 14px !important;
    font-size: 16px !important;
    min-height: 48px !important;
    -webkit-appearance: none !important;
  }
  .frame-lock-actions > button {
    min-height: 48px !important;
    font-size: 15px !important;
  }
}

/* Above 600px: no backdrop needed */
@media (min-width: 601px) {
  .frame-sidebar-backdrop {
    display: none;
  }
}

/* ── Fluid message bubbles ── */
.frame-msg-bubble {
  max-width: clamp(200px, 75%, 600px);
  min-width: 80px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: clamp(13px, 1.4vw, 16px);
  line-height: 1.4;
  word-break: break-word;
  overflow-wrap: break-word;
}

/* ── Fluid chat header ── */
.frame-chat-header-name {
  font-size: clamp(12px, 1.3vw, 15px);
  font-weight: 600;
  color: #e6edf3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Fluid chat input area ── */
.frame-chat-input-area {
  display: flex;
  align-items: flex-end;
  padding: clamp(6px, 1vw, 10px) clamp(8px, 1.2vw, 14px);
  border-top: 1px solid #30363d;
  background-color: #161b22;
}

.frame-chat-textarea {
  flex: 1;
  padding: clamp(8px, 0.8vw, 10px) 4px;
  border: none;
  background-color: transparent;
  color: #c9d1d9;
  font-size: clamp(14px, 1.4vw, 16px);
  font-family: inherit;
  resize: none;
  line-height: 20px;
  min-height: clamp(36px, 4vw, 40px);
  max-height: 100px;
  overflow: auto;
  outline: none;
  transition: height 0.1s ease;
}

/* ── Landing page fluid typography ── */
.frame-hero-title {
  font-size: clamp(24px, 5vw, 56px) !important;
  font-weight: 800;
  line-height: 1.2;
  max-width: 700px;
  word-break: break-word;
  overflow-wrap: break-word;
  hyphens: auto;
}

.frame-hero-subtitle {
  font-size: clamp(14px, 2vw, 19px);
  line-height: 1.6;
  max-width: 560px;
  word-break: break-word;
  overflow-wrap: break-word;
}

.frame-section-title {
  font-size: clamp(20px, 3.5vw, 36px);
  font-weight: 700;
  word-break: break-word;
  overflow-wrap: break-word;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

/* ── Feature grid: 3 equal columns desktop, auto-fit smaller ── */
.frame-feature-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: clamp(16px, 2vw, 24px);
}

@media (max-width: 900px) and (min-width: 601px) {
  .frame-feature-grid {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}

/* ── Trust signals: natural flex wrap ── */
.frame-trust-signals {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: clamp(12px, 3vw, 40px);
  padding: clamp(16px, 3vw, 32px) clamp(12px, 4vw, 48px);
}

/* ── Landing nav fluid padding ── */
.frame-landing-nav {
  padding: clamp(8px, 1.5vw, 12px) clamp(12px, 4vw, 48px);
}

/* ── Landing section fluid padding ── */
.frame-landing-section {
  padding: clamp(40px, 8vw, 96px) clamp(12px, 4vw, 48px);
}

.frame-landing-hero {
  padding: clamp(48px, 10vw, 120px) clamp(12px, 4vw, 48px) clamp(40px, 7vw, 80px);
}

/* ── How-it-works steps container ── */
.frame-how-it-works-steps {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 0;
  max-width: 900px;
  margin: 0 auto;
  align-items: stretch;
  justify-content: center;
}

/* ── How-it-works connector line ── */
.frame-step-connector {
  display: flex;
  align-items: center;
  padding-bottom: 60px;
}

/* ── Security architecture diagram ── */
.frame-arch-diagram {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0;
}

.frame-arch-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 8px;
}

/* ── Hero CTA container ── */
.frame-hero-ctas {
  display: flex;
  flex-direction: row;
  gap: 16px;
  margin-top: 36px;
  position: relative;
  z-index: 1;
  animation: frame-fade-in 0.8s ease-out 0.3s both;
  flex-wrap: wrap;
  justify-content: center;
}

/* ── Footer links ── */
.frame-footer-links {
  display: flex;
  justify-content: center;
  gap: clamp(16px, 3vw, 24px);
  flex-wrap: wrap;
  margin-bottom: 24px;
}

.frame-footer-links > * {
  min-height: 48px;
  min-width: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: clamp(8px, 1.5vw, 4px) clamp(8px, 1.5vw, 4px);
}

/* ── Hamburger menu: only show below 600px ── */
@media (min-width: 601px) {
  .frame-mobile-menu { display: none !important; }
  .frame-desktop-nav { display: flex !important; }
}
@media (max-width: 600px) {
  .frame-mobile-menu { display: block !important; }
  .frame-desktop-nav { display: none !important; }
}

/* ══════════════════════════════════════════════════
   MOBILE OPTIMIZATIONS (320px - 600px)
   ══════════════════════════════════════════════════ */
@media (max-width: 600px) {

  /* ── Global: prevent horizontal overflow ── */
  html, body {
    overflow-x: hidden !important;
    max-width: 100vw !important;
  }

  /* ── Minimum font size: 14px everywhere ── */
  .frame-landing-nav,
  .frame-landing-hero,
  .frame-landing-section,
  .frame-trust-signals,
  footer {
    font-size: 14px;
  }

  /* ── Hero title: aggressive clamp for 320px ── */
  .frame-hero-title {
    font-size: clamp(22px, 6.5vw, 36px) !important;
    line-height: 1.2 !important;
    max-width: 100% !important;
    padding: 0 4px;
  }

  .frame-hero-subtitle {
    font-size: clamp(14px, 3.8vw, 17px) !important;
    line-height: 1.5 !important;
    max-width: 100% !important;
    padding: 0 4px;
    min-height: auto !important;
  }

  .frame-section-title {
    font-size: clamp(20px, 5.5vw, 28px) !important;
    line-height: 1.25 !important;
  }

  /* ── Hero: reduce padding for small screens ── */
  .frame-landing-hero {
    padding: clamp(40px, 8vw, 60px) clamp(12px, 4vw, 24px) clamp(32px, 6vw, 48px) !important;
  }

  /* ── CTAs: full-width stacked vertically, 48px min height ── */
  .frame-hero-ctas {
    flex-direction: column !important;
    width: 100% !important;
    padding: 0 4px;
  }

  .frame-hero-ctas > button {
    width: 100% !important;
    min-height: 48px !important;
    font-size: 16px !important;
    padding: 14px 20px !important;
    box-sizing: border-box !important;
  }

  /* ── Trust signals: 2x2 grid ── */
  .frame-trust-signals {
    display: grid !important;
    grid-template-columns: 1fr 1fr !important;
    gap: clamp(10px, 2.5vw, 16px) !important;
    padding: clamp(16px, 3vw, 24px) clamp(12px, 3vw, 20px) !important;
    justify-items: center;
  }

  .frame-trust-signals > div {
    font-size: 14px !important;
    gap: 6px !important;
    flex-direction: column !important;
    text-align: center !important;
    align-items: center !important;
  }

  .frame-trust-signals > div > span {
    font-size: 14px !important;
    line-height: 1.3 !important;
  }

  /* ── Feature grid: single column, no overflow ── */
  .frame-feature-grid {
    grid-template-columns: 1fr !important;
    gap: clamp(12px, 3vw, 16px) !important;
    max-width: 100% !important;
    overflow: hidden !important;
  }

  .frame-feature-grid > div {
    max-width: 100% !important;
    overflow: hidden !important;
  }

  /* ── How-it-works: vertical stack, hide connectors ── */
  .frame-how-it-works-steps {
    flex-direction: column !important;
    align-items: center !important;
    gap: clamp(24px, 5vw, 32px) !important;
  }

  .frame-step-connector {
    display: none !important;
  }

  /* ── Security architecture: stack vertically ── */
  .frame-arch-diagram {
    flex-direction: column !important;
    gap: clamp(12px, 3vw, 16px) !important;
  }

  .frame-arch-arrow {
    transform: rotate(90deg);
    padding: 4px 0 !important;
  }

  .frame-arch-arrow svg {
    transform: rotate(0deg);
  }

  /* ── Footer links: wrap with 48px tap targets ── */
  .frame-footer-links {
    gap: clamp(8px, 2vw, 16px) !important;
    flex-wrap: wrap !important;
    justify-content: center !important;
  }

  .frame-footer-links > * {
    min-height: 48px !important;
    min-width: 48px !important;
    font-size: 14px !important;
    padding: 12px 16px !important;
  }

  /* ── Mobile menu dropdown: full width ── */
  .frame-mobile-menu > div > div:last-child {
    position: fixed !important;
    top: 56px !important;
    left: 0 !important;
    right: 0 !important;
    margin-top: 0 !important;
    border-radius: 0 0 8px 8px !important;
    min-width: 100vw !important;
    width: 100vw !important;
    box-sizing: border-box !important;
  }

  .frame-mobile-menu button {
    min-height: 48px !important;
    font-size: 16px !important;
    padding: 12px 20px !important;
  }

  /* ── All SVGs scale proportionally ── */
  svg {
    max-width: 100%;
    height: auto;
  }

  /* ── Section padding override ── */
  .frame-landing-section {
    padding: clamp(32px, 6vw, 48px) clamp(12px, 3vw, 20px) !important;
  }

  /* ── Landing nav: tighter on mobile ── */
  .frame-landing-nav {
    padding: 8px clamp(12px, 3vw, 20px) !important;
  }

  /* ── Ensure no body text is smaller than 14px on mobile ── */
  .frame-landing-hero p,
  .frame-landing-section p,
  .frame-trust-signals span,
  footer p,
  footer span,
  footer a {
    font-size: 14px !important;
  }

  /* Architecture diagram labels can be slightly smaller */
  .frame-arch-diagram span {
    font-size: 13px !important;
  }

  .frame-arch-arrow span {
    font-size: 11px !important;
  }

  /* ── Guest CTA button: full width on mobile ── */
  .frame-landing-hero > button {
    width: calc(100% - 8px) !important;
    min-height: 48px !important;
    margin-left: 4px !important;
    margin-right: 4px !important;
    box-sizing: border-box !important;
  }
}

/* ══════════════════════════════════════════════════
   MOBILE TOUCH, PERFORMANCE & UX ENHANCEMENTS
   ══════════════════════════════════════════════════ */

/* 1. Prevent iOS zoom on input focus (requires >= 16px font-size) */
@media (max-width: 600px) {
  input, select, textarea {
    font-size: 16px !important;
  }
}

/* ══════════════════════════════════════════════════
   CHAT WINDOW MOBILE OPTIMIZATIONS (320px - 600px)
   ══════════════════════════════════════════════════ */
@media (max-width: 600px) {

  /* ── 1. Message bubbles: wider, better padding, min 14px font ── */
  .frame-msg-bubble,
  .frame-msg-row > div:not(.frame-msg-hover-actions) {
    max-width: 85% !important;
    padding: 10px 14px !important;
    font-size: clamp(14px, 3.8vw, 16px) !important;
    line-height: 1.45 !important;
  }

  /* ── 2. Header: compact single-line ── */
  .frame-chat-header-name {
    font-size: clamp(14px, 3.8vw, 16px) !important;
    max-width: 50vw !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }

  /* ── 5. Input area: taller touch target, safe area ── */
  .frame-chat-input-area {
    padding: 6px 8px !important;
    padding-bottom: max(6px, env(safe-area-inset-bottom)) !important;
  }

  .frame-chat-textarea {
    min-height: 40px !important;
    font-size: 16px !important;
    padding: 10px 4px !important;
  }

  /* ── 8. Typing indicator: compact ── */
  .frame-typing-compact {
    font-size: 11px !important;
    padding: 2px 6px !important;
    min-height: 16px !important;
  }

  /* ── 10. Long-press: disable native context menu and text selection on msg bubbles ── */
  .frame-msg-row {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }

  /* ── 12. Reactions: smaller badges on mobile ── */
  .frame-reaction-badge {
    padding: 1px 5px !important;
    font-size: 11px !important;
    gap: 2px !important;
  }

  /* ── 15. Date separators: smaller on mobile ── */
  .frame-date-sep-text {
    font-size: 10px !important;
    letter-spacing: 0.04em !important;
  }
}

/* ── Overlay fade-in (global, outside media query) ── */
@keyframes frame-overlay-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 2. Safe area insets for notched phones (fixed bottom elements) */
@media (max-width: 600px) {
  .frame-chat-input-area,
  .frame-bottom-fixed,
  .frame-sidebar-actions-mobile {
    padding-bottom: env(safe-area-inset-bottom);
  }
}

/* 3. Touch action optimization — prevent 300ms tap delay */
button, a, [role="button"], .frame-interactive {
  touch-action: manipulation;
}

/* 4. Smooth scrolling on scroll containers (iOS momentum) */
.frame-scroll-container,
.frame-sidebar,
.frame-chat-textarea,
.frame-chat-messages {
  -webkit-overflow-scrolling: touch;
}

/* 5. No text selection on interactive elements */
button, a, [role="button"], .frame-interactive, .frame-mobile-menu {
  -webkit-user-select: none;
  user-select: none;
}

/* 6. Tap highlight removal */
button, a, input, textarea, select, [role="button"], .frame-interactive {
  -webkit-tap-highlight-color: transparent;
}

/* 7. Prevent pull-to-refresh interference on scroll containers */
.frame-scroll-container,
.frame-sidebar,
.frame-chat-messages {
  overscroll-behavior: contain;
}

/* 8. Font smoothing — crisp text on retina displays */
body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  font-family: ${FONT_BODY};
}

/* 9. Mobile-specific button styles — 44px min touch target */
@media (max-width: 600px) {
  button, [role="button"], .frame-interactive {
    min-height: 44px;
    padding: 10px 16px;
  }
}

/* 10. Bottom sheet animation keyframes — slide-up/down for mobile dialogs */
@keyframes frame-bottom-sheet-slide-up {
  from { opacity: 0; transform: translateY(100%); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes frame-bottom-sheet-slide-down {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(100%); }
}

/* Screenshot & copy protection for message content */
.frame-message-content, .frame-msg-bubble {
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.frame-message-content img, .frame-msg-bubble img {
  -webkit-user-drag: none;
  pointer-events: none;
}

/* Privacy fade-in animation */
@keyframes frame-privacy-fade-in {
  from { opacity: 1; }
  to { opacity: 0; }
}

@media (max-width: 600px) {
  .frame-bottom-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 300;
    background: #161b22;
    border-radius: 16px 16px 0 0;
    padding: 16px;
    padding-bottom: env(safe-area-inset-bottom);
    animation: frame-bottom-sheet-slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1) forwards;
    max-height: 85vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }
  .frame-bottom-sheet-closing {
    animation: frame-bottom-sheet-slide-down 0.25s ease-in forwards;
  }
}

/* 11. Backdrop blur for mobile overlays */
.frame-overlay-backdrop {
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

@media (max-width: 600px) {
  .frame-overlay-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 299;
  }
  .frame-overlay-backdrop-hidden {
    display: none;
  }
}

/* 12. Hardware acceleration — GPU compositing for animated elements */
.frame-bottom-sheet,
[class*="frame-animate"] {
  transform: translateZ(0);
  will-change: transform, opacity;
  backface-visibility: hidden;
}

/* Sidebar: only promote to GPU layer on mobile where it slides */
@media (max-width: 600px) {
  .frame-sidebar {
    transform: translateZ(0);
    will-change: transform;
    backface-visibility: hidden;
  }
}

/* ══════════════════════════════════════════════════
   VERY SMALL SCREENS (320px)
   ══════════════════════════════════════════════════ */
@media (max-width: 360px) {
  .frame-hero-title {
    font-size: clamp(20px, 6vw, 28px) !important;
    line-height: 1.25 !important;
  }

  .frame-hero-subtitle {
    font-size: 14px !important;
  }

  .frame-section-title {
    font-size: clamp(18px, 5vw, 24px) !important;
  }

  .frame-trust-signals {
    grid-template-columns: 1fr 1fr !important;
    gap: 8px !important;
    padding: 12px 8px !important;
  }

  .frame-trust-signals > div > svg {
    width: 20px !important;
    height: 20px !important;
  }

  .frame-landing-hero {
    padding: 32px 8px 28px !important;
  }

  .frame-landing-section {
    padding: 28px 8px !important;
  }

  .frame-landing-nav {
    padding: 6px 8px !important;
  }
}

/* ══════════════════════════════════════════════════
   REPLY QUOTE STYLING
   ══════════════════════════════════════════════════ */

/* Reply quote text: 2-line clamp with ellipsis */
.frame-reply-quote-text {
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  display: -webkit-box;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Reply quote hover feedback */
.frame-reply-quote:hover {
  filter: brightness(1.1);
}

/* ══════════════════════════════════════════════════
   ADDITIONAL MOBILE FIXES
   ══════════════════════════════════════════════════ */
@media (max-width: 600px) {
  /* Reply preview bar: ensure no overflow */
  .frame-reply-preview-mobile {
    max-width: 100vw !important;
    overflow: hidden !important;
  }

  /* Sign-in page: stack vertically, prevent overflow */
  .frame-auth-form {
    max-width: 100% !important;
    padding: 16px !important;
    overflow-x: hidden !important;
  }

  /* Ensure dialog modals stay within viewport */
  [role="dialog"] {
    max-width: 100vw !important;
    overflow-x: hidden !important;
  }

  /* Context menu: keep within screen bounds */
  .frame-context-menu-mobile {
    left: 8px !important;
    right: 8px !important;
    max-width: calc(100vw - 16px) !important;
  }

  /* Sync error indicator: wrap on small screens */
  .frame-sync-error {
    flex-wrap: wrap !important;
  }
}

/* ══════════════════════════════════════════════════
   NEW CHAT DIALOG MOBILE TABS
   ══════════════════════════════════════════════════ */
@media (max-width: 600px) {
  /* Ensure bottom-sheet tab labels don't truncate */
  [role="dialog"] button {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

/* ══════════════════════════════════════════════════
   TOAST & FEEDBACK VISIBILITY
   ══════════════════════════════════════════════════ */

/* Ensure toasts render above all overlays including dialogs */
.frame-toast-container {
  z-index: 10001 !important;
}

/* ══════════════════════════════════════════════════
   CIPHER TYPING INDICATOR
   ══════════════════════════════════════════════════ */
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ══════════════════════════════════════════════════
   SELF-DESTRUCT MESSAGE ANIMATION
   ══════════════════════════════════════════════════ */
@keyframes frame-self-destruct {
  0% { opacity: 1; filter: none; transform: scale(1); }
  25% { opacity: 0.9; filter: brightness(1.3) sepia(0.3); }
  50% { opacity: 0.5; filter: brightness(1.8) blur(2px) sepia(0.5); transform: scale(0.95); }
  75% { opacity: 0.2; filter: brightness(2.5) blur(5px); transform: scale(0.85); }
  100% { opacity: 0; filter: brightness(3) blur(8px); transform: scale(0.8); height: 0; padding: 0; margin: 0; }
}

@keyframes frame-destruct-flash {
  0% { opacity: 0.05; }
  100% { opacity: 0; }
}

@keyframes frame-destruct-text-fade {
  0% { opacity: 0; transform: scale(0.9); max-height: 40px; padding: 8px 16px; margin-top: 4px; }
  20% { opacity: 1; transform: scale(1); max-height: 40px; padding: 8px 16px; margin-top: 4px; }
  80% { opacity: 1; transform: scale(1); max-height: 40px; padding: 8px 16px; margin-top: 4px; }
  90% { opacity: 0; transform: scale(0.95); max-height: 40px; padding: 8px 16px; margin-top: 4px; }
  100% { opacity: 0; transform: scale(0.95); max-height: 0; padding: 0; margin-top: 0; }
}

/* ══════════════════════════════════════════════════
   ACCESSIBILITY: REDUCED MOTION
   ══════════════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

/**
 * Inject global CSS styles into the document head.
 * Safe to call multiple times — only injects once.
 */
export function injectGlobalStyles(): void {
  if (document.getElementById(GLOBAL_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = GLOBAL_STYLE_ID;
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}
