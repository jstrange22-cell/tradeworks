import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/tradeworks/' : '/',
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core + data layer (tightly coupled via hooks, avoids circular refs)
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/zustand/') ||
            id.includes('node_modules/@tanstack/react-query') ||
            id.includes('node_modules/@tanstack/react-virtual')
          ) {
            return 'vendor-react';
          }

          // Charting — Recharts + Lightweight Charts (heaviest deps, lazy-loaded pages only)
          if (id.includes('node_modules/recharts') || id.includes('node_modules/lightweight-charts')) {
            return 'vendor-charts';
          }

          // Solana — wallet adapters + web3.js (only loaded on /solana page)
          if (id.includes('node_modules/@solana/')) {
            return 'vendor-solana';
          }

          // UI utilities — icons, toasts, command palette
          if (
            id.includes('node_modules/lucide-react') ||
            id.includes('node_modules/sonner') ||
            id.includes('node_modules/cmdk')
          ) {
            return 'vendor-ui';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/crypto-api': {
        target: 'https://api.crypto.com/exchange/v1/public',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/crypto-api/, ''),
      },
      '/api/v1': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
