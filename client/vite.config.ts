import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const serverPort = process.env.SERVER_PORT ?? '3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    // In dev the client talks to the Socket.IO server through this proxy.
    proxy: {
      '/socket.io': { target: `http://localhost:${serverPort}`, ws: true },
      '/health': { target: `http://localhost:${serverPort}` },
    },
  },
});
