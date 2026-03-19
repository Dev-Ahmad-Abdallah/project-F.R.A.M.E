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

/* Below 600px: sidebar becomes a slide-over overlay */
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
    animation: frame-sidebar-slide-in 0.25s ease-out;
  }
  .frame-sidebar-hidden {
    transform: translateX(-100%);
    pointer-events: none;
  }
  .frame-sidebar-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 199;
  }
  .frame-sidebar-backdrop-hidden {
    display: none;
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
  font-size: clamp(28px, 5vw, 56px) !important;
  font-weight: 800;
  line-height: 1.15;
  max-width: 700px;
}

.frame-hero-subtitle {
  font-size: clamp(14px, 2vw, 19px);
  line-height: 1.6;
  max-width: 560px;
}

.frame-section-title {
  font-size: clamp(22px, 3.5vw, 36px);
  font-weight: 700;
}

/* ── Feature grid: auto-fit columns ── */
.frame-feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

/* ── Trust signals: natural flex wrap ── */
.frame-trust-signals {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: clamp(16px, 3vw, 40px);
  padding: clamp(20px, 3vw, 32px) clamp(16px, 4vw, 48px);
}

/* ── Landing nav fluid padding ── */
.frame-landing-nav {
  padding: 12px clamp(16px, 4vw, 48px);
}

/* ── Landing section fluid padding ── */
.frame-landing-section {
  padding: clamp(48px, 8vw, 96px) clamp(16px, 4vw, 48px);
}

.frame-landing-hero {
  padding: clamp(60px, 10vw, 120px) clamp(16px, 4vw, 48px) clamp(48px, 7vw, 80px);
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
