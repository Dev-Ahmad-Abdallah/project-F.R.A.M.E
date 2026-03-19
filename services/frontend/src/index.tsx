import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './notifications';
import { injectGlobalStyles } from './globalStyles';

// ── Error Boundary ──

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('App crashed:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            backgroundColor: '#0d1117',
            color: '#c9d1d9',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: 32,
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: 24, fontWeight: 600, color: '#f85149', margin: '0 0 12px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: '#8b949e', margin: '0 0 24px', maxWidth: 400 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 24px',
              fontSize: 14,
              fontWeight: 600,
              backgroundColor: '#238636',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

injectGlobalStyles();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Register service worker for push notifications (production only)
if (process.env.NODE_ENV === 'production') {
  registerServiceWorker().catch((err) => {
    console.warn('Service worker registration failed:', err);
  });
}
