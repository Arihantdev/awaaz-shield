// Defaults to the same host the page was loaded from (so it works from "localhost" and
// from a LAN IP like 192.168.x.x without changing settings) — only overridden when
// VITE_API_BASE_URL is explicitly set, e.g. for a separately hosted backend.
const DEFAULT_BASE = `${location.protocol}//${location.hostname}:8000`;
// VITE_SAME_ORIGIN=true: call the API on the page's own origin (the dev server proxies /api and /ws to the backend).
// That is what makes one https tunnel enough to use the app from a phone (see "Two phones" in the README).
const SAME_ORIGIN = import.meta.env.VITE_SAME_ORIGIN === "true";
const BASE = import.meta.env.VITE_API_BASE_URL || (SAME_ORIGIN ? "" : DEFAULT_BASE);

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include", // backend session lives in an httpOnly cookie
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      /* ignore */
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  status: () => request("/api/status"),

  devLogin: (email) => request("/api/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),
  exchangeFirebaseToken: (idToken) =>
    request("/api/auth/session", { method: "POST", body: JSON.stringify({ id_token: idToken }) }),
  me: () => request("/api/auth/me"),
  logout: () => request("/api/auth/logout", { method: "POST" }),

  consent: () => request("/api/consent"),
  acceptConsent: (version, language = "en") => request("/api/consent", { method: "POST", body: JSON.stringify({ version, language }) }),

  listCalls: () => request("/api/calls"),
  createCall: (label, source = "simulated") =>
    request("/api/calls", { method: "POST", body: JSON.stringify({ label, source }) }),
  getCall: (id) => request(`/api/calls/${id}`),
  ingest: (id, text, speaker = "caller") =>
    request(`/api/calls/${id}/ingest`, { method: "POST", body: JSON.stringify({ text, speaker }) }),
  evaluate: (id, message) =>
    request(`/api/calls/${id}/evaluate`, { method: "POST", body: JSON.stringify({ message }) }),
  endCall: (id) => request(`/api/calls/${id}/end`, { method: "POST" }),
  recordAction: (id, type, note = "") =>
    request(`/api/calls/${id}/actions`, { method: "POST", body: JSON.stringify({ type, note }) }),

  startVoiceCall: (label) => request("/api/voice/calls", { method: "POST", body: JSON.stringify({ label }) }),
  voiceRoom: (code) => request(`/api/voice/rooms/${encodeURIComponent(code)}`),

  analytics: () => request("/api/analytics"),

  resetDemo: () => request("/api/demo/reset", { method: "POST" }),
  addPattern: (category, phrase, weight, language) =>
    request("/api/demo/patterns", { method: "POST", body: JSON.stringify({ category, phrase, weight, language }) }),
};
