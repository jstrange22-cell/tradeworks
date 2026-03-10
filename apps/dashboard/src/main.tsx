import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { App } from './App';
import './index.css';

// Apply persisted theme before React renders to prevent flash
const persistedUI = localStorage.getItem('tradeworks-ui');
if (persistedUI) {
  try {
    const { state } = JSON.parse(persistedUI);
    document.documentElement.classList.toggle('dark', state?.theme !== 'light');
  } catch {
    document.documentElement.classList.add('dark');
  }
} else {
  document.documentElement.classList.add('dark');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
