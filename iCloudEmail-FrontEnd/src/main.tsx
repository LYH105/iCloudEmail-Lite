import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { ToastProvider } from './ui';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ToastProvider>
  </StrictMode>,
);
