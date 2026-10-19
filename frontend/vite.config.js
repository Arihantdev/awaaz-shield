import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `server` was previously nested inside itself, so its port/host settings were silently ignored.
// Set VITE_HOST=true to expose the dev server on your network (e.g. to open it on a phone).
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 900 }, // three.js loads only on login/call screens
  server: {
    port: 5173,
    strictPort: true,
    host: process.env.VITE_HOST === "true",
    // A tunnel (ngrok, cloudflared...) sends its own hostname; only accept that when the server is deliberately exposed.
    allowedHosts: process.env.VITE_HOST === "true" ? true : undefined,
    // With VITE_SAME_ORIGIN=true the browser talks only to this server, which forwards to the backend:
    // one https address then covers the page, the API and the call audio (needed for a microphone on a phone).
    proxy: {
      "/api": { target: `http://127.0.0.1:${process.env.BACKEND_PORT || 8000}`, changeOrigin: false },
      "/ws": { target: `ws://127.0.0.1:${process.env.BACKEND_PORT || 8000}`, ws: true, changeOrigin: false },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
