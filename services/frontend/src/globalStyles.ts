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
/* Hover states */
button:hover:not(:disabled) { filter: brightness(1.15); }
button:active:not(:disabled) { filter: brightness(0.9); transform: scale(0.98); }
button:disabled { opacity: 0.5; cursor: not-allowed; }

/* Focus visible */
button:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #58a6ff;
}

/* Input placeholder */
input::placeholder { color: #8b949e; }

/* Scrollbar styling for dark theme */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: #0d1117; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }

/* Modal entrance animation */
@keyframes frame-modal-enter {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

/* Smooth transitions */
* { box-sizing: border-box; }

/* ── Fluid Responsive Design ── */

/* Sidebar: fluid width, overlay below 600px */
@keyframes frame-sidebar-slide-in {
  from { transform: translateX(-100%); }
  to { transform: translateX(0); }
}

.frame-sidebar {
  width: clamp(240px, 25vw, 320px);
  min-width: clamp(240px, 25vw, 320px);
  display: flex;
  flex-direction: column;
  background-color: #161b22;
  border-right: 1px solid #30363d;
  height: 100%;
  overflow: hidden;
  transition: width 0.3s ease, min-width 0.3s ease;
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
  border-radius: 12px;
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
  padding: clamp(6px, 1vw, 12px) clamp(8px, 1.2vw, 16px);
  border-top: 1px solid #30363d;
  background-color: #161b22;
}

.frame-chat-textarea {
  flex: 1;
  padding: clamp(6px, 0.8vw, 10px) 6px;
  border: none;
  background-color: transparent;
  color: #c9d1d9;
  font-size: clamp(14px, 1.4vw, 16px);
  font-family: inherit;
  resize: none;
  line-height: 20px;
  min-height: clamp(32px, 4vw, 40px);
  max-height: 116px;
  overflow: auto;
  outline: none;
}

/* ── Landing page fluid typography ── */
.frame-hero-title {
  font-size: clamp(24px, 5vw, 56px) !important;
  font-weight: 800;
  line-height: 1.15;
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
}

/* ── Feature grid: auto-fit columns ── */
.frame-feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: clamp(12px, 2vw, 20px);
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

  /* ── 5. Input area: taller touch target ── */
  .frame-chat-input-area {
    padding: 6px 8px !important;
  }

  .frame-chat-textarea {
    min-height: 48px !important;
    font-size: 16px !important;
    padding: 12px 6px !important;
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

/* ── Bottom sheet animations (global, outside media query) ── */
@keyframes frame-bottom-sheet-slide-up {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

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
}

/* 9. Mobile-specific button styles — 44px min touch target */
@media (max-width: 600px) {
  button, [role="button"], .frame-interactive {
    min-height: 44px;
    padding: 10px 16px;
  }
}

/* 10. Bottom sheet animation keyframes — slide-up for mobile dialogs */
@keyframes frame-bottom-sheet-slide-up {
  from {
    opacity: 0;
    transform: translateY(100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes frame-bottom-sheet-slide-down {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(100%);
  }
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
    animation: frame-bottom-sheet-slide-up 0.3s ease-out forwards;
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
.frame-sidebar,
.frame-bottom-sheet,
[class*="frame-animate"] {
  transform: translateZ(0);
  will-change: transform, opacity;
  backface-visibility: hidden;
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
