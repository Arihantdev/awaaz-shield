import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api";

// This tracks the BACKEND session specifically — not just "Firebase says
// I'm logged in". A page reload re-checks /api/auth/me so a stale/expired
// backend session never shows the dashboard as if it were authenticated.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [identity, setIdentity] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // A sleeping server (free hosting) answers late, with 502/503 or a dropped connection. That must NOT look like
    // "you are signed out", so keep asking for up to ~2 minutes; only a real 401/403 means no session.
    let alive = true;
    (async () => {
      const started = Date.now();
      for (let attempt = 0; alive; attempt++) {
        try {
          const me = await api.me();
          if (alive) setIdentity(me);
          break;
        } catch (e) {
          const retryable = !e.status || e.status >= 500;
          if (!retryable || Date.now() - started > 120000) {
            if (alive) setIdentity(null);
            break;
          }
          await new Promise((r) => setTimeout(r, Math.min(1000 + attempt * 500, 4000)));
        }
      }
      if (alive) setChecking(false);
    })();
    return () => { alive = false; };
  }, []);

  async function logout() {
    try {
      await api.logout();
    } finally {
      setIdentity(null);
    }
  }

  return (
    <AuthContext.Provider value={{ identity, setIdentity, checking, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
