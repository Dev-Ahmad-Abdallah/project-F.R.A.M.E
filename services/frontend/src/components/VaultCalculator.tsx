/**
 * VaultCalculator — Calculator disguise for F.R.A.M.E. (Vault Mode).
 *
 * When Vault Mode is active, the entire app UI is replaced with this
 * fully functional calculator. Entering the user's secret PIN followed
 * by "=" unlocks the real messaging interface.
 *
 * Design: iOS-style dark calculator with large buttons and display.
 * No branding, no hint that a messaging app is underneath.
 */

import React, { useState, useCallback, useEffect } from 'react';

interface VaultCalculatorProps {
  onUnlock: () => void;
}

const VaultCalculator: React.FC<VaultCalculatorProps> = ({ onUnlock }) => {
  const [display, setDisplay] = useState('0');
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);
  const [secretBuffer, setSecretBuffer] = useState('');

  // Read PIN from localStorage (default: 1337)
  const PIN = localStorage.getItem('frame-vault-pin') || '1337';

  // Change document title to "Calculator" while mounted
  useEffect(() => {
    const originalTitle = document.title;
    document.title = 'Calculator';

    // Attempt to swap favicon to a calculator icon (data URI)
    let originalFavicon: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const linkEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (linkEl) {
      originalFavicon = linkEl.href;
      // Simple calculator SVG favicon
      linkEl.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="16" fill="%23333"/><rect x="15" y="12" width="70" height="25" rx="4" fill="%2398ff98"/><rect x="15" y="45" width="14" height="14" rx="3" fill="%23666"/><rect x="35" y="45" width="14" height="14" rx="3" fill="%23666"/><rect x="55" y="45" width="14" height="14" rx="3" fill="%23666"/><rect x="75" y="45" width="14" height="14" rx="3" fill="%23f90"/><rect x="15" y="65" width="14" height="14" rx="3" fill="%23666"/><rect x="35" y="65" width="14" height="14" rx="3" fill="%23666"/><rect x="55" y="65" width="14" height="14" rx="3" fill="%23666"/><rect x="75" y="65" width="14" height="14" rx="3" fill="%23f90"/><rect x="15" y="85" width="34" height="14" rx="3" fill="%23666"/><rect x="55" y="85" width="14" height="14" rx="3" fill="%23666"/><rect x="75" y="85" width="14" height="14" rx="3" fill="%23f90"/></svg>';
    }

    return () => {
      document.title = originalTitle;
      if (linkEl && originalFavicon) {
        linkEl.href = originalFavicon;
      }
    };
  }, []);

  const handleButton = useCallback((val: string) => {
    // Track the secret sequence
    const newBuffer = secretBuffer + val;

    // Check if user typed PIN + "="
    if (val === '=' && newBuffer.slice(0, -1) === PIN) {
      onUnlock();
      return;
    }

    // Keep buffer trimmed to PIN length + 1
    const trimmedBuffer = newBuffer.length > PIN.length + 1
      ? newBuffer.slice(-(PIN.length + 1))
      : newBuffer;
    setSecretBuffer(trimmedBuffer);

    // Normal calculator logic
    if (val === 'C') {
      setDisplay('0');
      setPreviousValue(null);
      setOperator(null);
      setWaitingForOperand(false);
      setSecretBuffer('');
      return;
    }

    if (val === '±') {
      setDisplay((prev) => {
        if (prev === '0') return '0';
        return prev.startsWith('-') ? prev.slice(1) : '-' + prev;
      });
      return;
    }

    if (val === '%') {
      setDisplay((prev) => {
        const num = parseFloat(prev);
        if (isNaN(num)) return '0';
        return String(num / 100);
      });
      return;
    }

    if (val === '.') {
      if (waitingForOperand) {
        setDisplay('0.');
        setWaitingForOperand(false);
        return;
      }
      setDisplay((prev) => (prev.includes('.') ? prev : prev + '.'));
      return;
    }

    if (['+', '-', '\u00D7', '\u00F7'].includes(val)) {
      const current = parseFloat(display);
      if (previousValue !== null && operator && !waitingForOperand) {
        const result = calculate(previousValue, current, operator);
        setDisplay(formatResult(result));
        setPreviousValue(result);
      } else {
        setPreviousValue(current);
      }
      setOperator(val);
      setWaitingForOperand(true);
      return;
    }

    if (val === '=') {
      const current = parseFloat(display);
      if (previousValue !== null && operator) {
        const result = calculate(previousValue, current, operator);
        setDisplay(formatResult(result));
        setPreviousValue(null);
        setOperator(null);
        setWaitingForOperand(true);
      }
      return;
    }

    // Digit
    if (waitingForOperand) {
      setDisplay(val);
      setWaitingForOperand(false);
    } else {
      setDisplay((prev) => (prev === '0' ? val : prev + val));
    }
  }, [display, previousValue, operator, waitingForOperand, secretBuffer, PIN, onUnlock]);

  const buttons: Array<{ label: string; value: string; type: 'function' | 'operator' | 'number' | 'zero' }> = [
    { label: 'C', value: 'C', type: 'function' },
    { label: '\u00B1', value: '±', type: 'function' },
    { label: '%', value: '%', type: 'function' },
    { label: '\u00F7', value: '\u00F7', type: 'operator' },
    { label: '7', value: '7', type: 'number' },
    { label: '8', value: '8', type: 'number' },
    { label: '9', value: '9', type: 'number' },
    { label: '\u00D7', value: '\u00D7', type: 'operator' },
    { label: '4', value: '4', type: 'number' },
    { label: '5', value: '5', type: 'number' },
    { label: '6', value: '6', type: 'number' },
    { label: '-', value: '-', type: 'operator' },
    { label: '1', value: '1', type: 'number' },
    { label: '2', value: '2', type: 'number' },
    { label: '3', value: '3', type: 'number' },
    { label: '+', value: '+', type: 'operator' },
    { label: '0', value: '0', type: 'zero' },
    { label: '.', value: '.', type: 'number' },
    { label: '=', value: '=', type: 'operator' },
  ];

  // Adjust display font size for long numbers
  const displayFontSize = display.length > 9 ? 36 : display.length > 6 ? 48 : 64;

  return (
    <div style={calcStyles.container}>
      {/* Display */}
      <div style={calcStyles.displayContainer}>
        <div
          style={{
            ...calcStyles.displayText,
            fontSize: displayFontSize,
          }}
        >
          {display}
        </div>
      </div>

      {/* Button grid */}
      <div style={calcStyles.buttonGrid}>
        {buttons.map((btn) => (
          <button
            key={btn.label + btn.value}
            type="button"
            style={{
              ...calcStyles.button,
              ...(btn.type === 'function' ? calcStyles.functionButton : {}),
              ...(btn.type === 'operator' ? calcStyles.operatorButton : {}),
              ...(btn.type === 'number' ? calcStyles.numberButton : {}),
              ...(btn.type === 'zero' ? { ...calcStyles.numberButton, ...calcStyles.zeroButton } : {}),
              ...(btn.type === 'operator' && operator === btn.value && waitingForOperand
                ? calcStyles.operatorActive
                : {}),
            }}
            onClick={() => handleButton(btn.value)}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
};

// ── Calculator helpers ──

function calculate(a: number, b: number, op: string): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '\u00D7': return a * b;
    case '\u00F7': return b !== 0 ? a / b : 0;
    default: return b;
  }
}

function formatResult(value: number): string {
  // Avoid floating point display issues
  const str = String(parseFloat(value.toPrecision(12)));
  if (str.length > 12) {
    return value.toExponential(6);
  }
  return str;
}

// ── Styles ──

const calcStyles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    inset: 0,
    backgroundColor: '#000000',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
    zIndex: 99999,
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  displayContainer: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: '0 24px 12px',
    minHeight: 120,
  },
  displayText: {
    color: '#ffffff',
    fontSize: 64,
    fontWeight: 300,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
  },
  buttonGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 12,
    padding: '0 12px 24px',
    paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
  },
  button: {
    border: 'none',
    borderRadius: '50%',
    fontSize: 28,
    fontWeight: 400,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: '1',
    transition: 'opacity 0.1s',
    WebkitTapHighlightColor: 'transparent',
    minHeight: 0,
    padding: 0,
  },
  functionButton: {
    backgroundColor: '#a5a5a5',
    color: '#000000',
    fontSize: 24,
  },
  operatorButton: {
    backgroundColor: '#ff9f0a',
    color: '#ffffff',
    fontSize: 32,
  },
  operatorActive: {
    backgroundColor: '#ffffff',
    color: '#ff9f0a',
  },
  numberButton: {
    backgroundColor: '#333333',
    color: '#ffffff',
  },
  zeroButton: {
    gridColumn: 'span 2',
    borderRadius: 40,
    aspectRatio: 'auto',
    justifyContent: 'flex-start',
    paddingLeft: 28,
    minHeight: 72,
  },
};

export default VaultCalculator;
