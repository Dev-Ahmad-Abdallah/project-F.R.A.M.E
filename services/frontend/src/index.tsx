import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './notifications';
import { injectGlobalStyles } from './globalStyles';

injectGlobalStyles();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for push notifications
registerServiceWorker().catch((err) => {
  console.warn('Service worker registration failed:', err);
});
