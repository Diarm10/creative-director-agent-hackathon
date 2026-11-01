import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the page talks to the API on port 3001 (npm run dev:api).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
});
