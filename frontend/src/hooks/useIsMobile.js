import { useEffect, useState } from "react";

/**
 * Which interface to show: the phone layout (bottom tabs, one task per screen) or the laptop layout (side rail, panels).
 * Automatic by screen size, but a person can force either one in Settings (the choice is remembered on this device).
 */
const KEY = "awaaz.ui";
const QUERY = "(max-width: 820px), (pointer: coarse) and (max-height: 500px)"; // narrow screens, and phones held sideways

export const readUiPref = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "mobile" || v === "desktop" ? v : "auto";
  } catch {
    return "auto";
  }
};

export function setUiPref(value) {
  try {
    if (value === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, value);
  } catch { /* storage can be blocked: the choice then lasts until reload */ }
  window.dispatchEvent(new Event("awaaz-ui"));
}

function compute() {
  const pref = readUiPref();
  if (pref === "mobile") return true;
  if (pref === "desktop") return false;
  return window.matchMedia(QUERY).matches;
}

export default function useIsMobile() {
  const [mobile, setMobile] = useState(compute);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setMobile(compute());
    mq.addEventListener("change", update);
    window.addEventListener("awaaz-ui", update);
    return () => { mq.removeEventListener("change", update); window.removeEventListener("awaaz-ui", update); };
  }, []);
  useEffect(() => { document.documentElement.dataset.ui = mobile ? "mobile" : "desktop"; }, [mobile]);
  return mobile;
}
