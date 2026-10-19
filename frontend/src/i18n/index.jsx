import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./en";

/**
 * Small, dependency-free translations. English is bundled; every other language is loaded on demand
 * (together with its font) when chosen. Missing keys fall back to English, so a gap never shows a raw key.
 * Strings use {name} placeholders and avoid plurals so they translate cleanly.
 */
export const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" },
  { code: "mr", label: "मराठी" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "ta", label: "தமிழ்" },
  { code: "te", label: "తెలుగు" },
  { code: "kn", label: "ಕನ್ನಡ" },
];

const LOADERS = {
  hi: () => Promise.all([import("./hi"), import("@fontsource-variable/noto-sans-devanagari")]),
  mr: () => Promise.all([import("./mr"), import("@fontsource-variable/noto-sans-devanagari")]),
  bn: () => Promise.all([import("./bn"), import("@fontsource-variable/noto-sans-bengali")]),
  gu: () => Promise.all([import("./gu"), import("@fontsource-variable/noto-sans-gujarati")]),
  ta: () => Promise.all([import("./ta"), import("@fontsource-variable/noto-sans-tamil")]),
  te: () => Promise.all([import("./te"), import("@fontsource-variable/noto-sans-telugu")]),
  kn: () => Promise.all([import("./kn"), import("@fontsource-variable/noto-sans-kannada")]),
};

const KEY = "awaaz.lang";
const known = (c) => LANGS.some((l) => l.code === c);

function initialLang() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && known(saved)) return saved;
  } catch { /* storage can be blocked */ }
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return known(nav) ? nav : "en";
}

const I18nContext = createContext({ lang: "en", setLang: () => {}, t: (k) => en[k] ?? k });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  const [dict, setDict] = useState(en);

  useEffect(() => {
    let live = true;
    document.documentElement.lang = lang;
    if (lang === "en") {
      setDict(en);
      return undefined;
    }
    LOADERS[lang]().then(([mod]) => live && setDict(mod.default)).catch(() => live && setDict(en));
    return () => { live = false; };
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!known(code)) return;
    try { localStorage.setItem(KEY, code); } catch { /* ignore */ }
    setLangState(code);
  }, []);

  const t = useCallback((key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  }, [dict]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Label for a scam-tactic category (falls back to the raw name for custom patterns). */
export function signalLabel(t, s) {
  const k = `sig.${s}`;
  const v = t(k);
  return v === k ? String(s).replace(/_/g, " ") : v;
}

export const useI18n = () => useContext(I18nContext);
export const useT = () => useContext(I18nContext).t;
