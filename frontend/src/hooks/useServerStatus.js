import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/** Loads /api/status (what the backend really has switched on) and refreshes it whenever the live socket reconnects. */
export function useServerStatus(wsStatus) {
  const [state, setState] = useState({ status: null, error: null });
  const connected = wsStatus === "connected";

  const load = useCallback(() => {
    return api
      .status()
      .then((status) => setState({ status, error: null }))
      .catch((error) => setState((prev) => ({ status: prev.status, error })));
  }, []);

  useEffect(() => { load(); }, [load, connected]);

  return { ...state, reload: load };
}
