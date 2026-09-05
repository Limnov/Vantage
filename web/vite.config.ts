import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootPackage = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'));

// GitHub Pages base path (set via CI_BASE_PATH env in GitHub Actions)
// For project pages, this is typically "/repository-name/"
const base = process.env.CI_BASE_PATH || '/';

export default defineConfig({
  plugins: [react()],
  define: { __VANTAGE_VERSION__: JSON.stringify(rootPackage.version) },
  base: base,
  server: {
    host: '127.0.0.1',
    port: 5177,
    allowedHosts: ['127.0.0.1', 'localhost'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3004',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
