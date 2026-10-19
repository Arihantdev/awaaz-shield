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
    api
      .me()
      .then(setIdentity)
      .catch(() => setIdentity(null))
      .finally(() => setChecking(false));
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
