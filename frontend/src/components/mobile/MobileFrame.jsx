import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Activity, History, House, PhoneCall, Settings } from "lucide-react";
import { Mark } from "../TopBar";
import LanguageSelect from "../LanguageSelect";
import { useT } from "../../i18n";

/**
 * The phone interface: a slim header, the screen, and a bottom tab bar. Every signed-in page is wrapped in this on a phone.
 * While a voice call is connecting or running, the tab bar is hidden so a stray tap cannot leave the call.
 */
const LockContext = createContext(null);

export function useTabLock(locked) {
  const ctx = useContext(LockContext);
  useEffect(() => {
    if (!ctx) return undefined;
    ctx.setLocked(locked);
    return () => ctx.setLocked(false);
  }, [ctx, locked]);
}

const TABS = [
  { id: "home", key: "m.tab.home", icon: House, to: "/dashboard" },
  { id: "calls", key: "m.tab.calls", icon: Activity, to: "/dashboard?v=calls" },
  { id: "voice", key: "m.tab.voice", icon: PhoneCall, to: "/call" },
  { id: "history", key: "nav.history", icon: History, to: "/history" },
  { id: "settings", key: "nav.settings", icon: Settings, to: "/settings" },
];

function activeTab(pathname, search) {
  if (pathname.startsWith("/call")) return "voice";
  if (pathname.startsWith("/history")) return "history";
  if (pathname.startsWith("/settings")) return "settings";
  return new URLSearchParams(search).get("v") === "calls" ? "calls" : "home";
}

export default function MobileFrame({ children }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [locked, setLocked] = useState(false);
  const value = useMemo(() => ({ setLocked }), []);
  const current = activeTab(pathname, search);

  return (
    <LockContext.Provider value={value}>
      <div className="m-frame" data-locked={locked}>
        <header className="m-top">
          <Mark size={24} />
          <b>Awaaz Shield</b>
          <LanguageSelect />
        </header>
        <main className="m-body">{children}</main>
        {!locked && (
          <nav className="m-tabs" aria-label={t("nav.main")}>
            {TABS.map(({ id, key, icon: Icon, to }) => (
              <button key={id} className="m-tab" aria-current={current === id ? "page" : undefined} onClick={() => current !== id && navigate(to)}>
                <Icon size={22} aria-hidden="true" />
                <span>{t(key)}</span>
              </button>
            ))}
          </nav>
        )}
      </div>
    </LockContext.Provider>
  );
}
