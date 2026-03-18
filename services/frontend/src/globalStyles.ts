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
input::placeholder { color: #484f58; }

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
