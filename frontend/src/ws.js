const DEFAULT_BASE = `${location.protocol}//${location.hostname}:8000`;
const SAME_ORIGIN = import.meta.env.VITE_SAME_ORIGIN === "true";
export const WS_BASE = import.meta.env.VITE_API_BASE_URL
  ? import.meta.env.VITE_API_BASE_URL.replace(/^http/, "ws")
  : SAME_ORIGIN
    ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`
    : DEFAULT_BASE.replace(/^http/, "ws");
const BASE = WS_BASE;

/**
 * Opens the dashboard websocket and calls onEvent for every message.
 * Auto-reconnects with backoff if the connection drops (the cookie-based
 * session travels automatically with the browser's WS handshake).
 * Returns a cleanup function.
 */
export function connectDashboardSocket(onEvent, onStatusChange = () => {}) {
  let socket = null;
  let closedByCaller = false;
  let retryDelay = 1000;

  function connect() {
    socket = new WebSocket(`${BASE}/ws/dashboard`);

    socket.onopen = () => {
      retryDelay = 1000;
      onStatusChange("connected");
    };

    socket.onmessage = (event) => {
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        /* ignore malformed frame */
      }
    };

    socket.onclose = () => {
      onStatusChange("disconnected");
      if (!closedByCaller) {
        setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 1.6, 15000);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  connect();

  return () => {
    closedByCaller = true;
    socket?.close();
  };
}
