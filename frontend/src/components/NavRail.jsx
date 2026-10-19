import * as Tooltip from "@radix-ui/react-tooltip";
import { motion } from "motion/react";
import { Activity, BarChart3, ChevronsLeft, ChevronsRight, History, LayoutDashboard, PhoneCall, Search, Settings } from "lucide-react";
import { Mark } from "./TopBar";
import { useT } from "../i18n";

const ITEMS = [
  { id: "monitor", key: "nav.monitor", icon: Activity },
  { id: "command", key: "nav.command", icon: LayoutDashboard },
  { id: "insights", key: "nav.insights", icon: BarChart3 },
];

// Tooltips only while the rail is collapsed; once it shows labels they would repeat them.
function Tip({ label, enabled, children }) {
  if (!enabled) return children;
  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side="right" sideOffset={10}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export default function NavRail({ view, onView, onPalette, onVoice, onHistory, onSettings, reviewCount, open, onToggle }) {
  const t = useT();
  return (
    <Tooltip.Provider>
      <nav className="nav" aria-label={t("nav.main")} data-open={open}>
        <div className="nav-logo"><Mark size={24} /><span className="nav-label nav-brand">Awaaz Shield</span></div>
        {ITEMS.map(({ id, key, icon: Icon }) => {
          const label = t(key);
          const active = view === id;
          return (
            <Tip key={id} label={label} enabled={!open}>
              <button className="nav-btn" aria-label={label} aria-current={active ? "page" : undefined} onClick={() => onView(id)}>
                {active && <motion.span layoutId="nav-active" className="nav-active" transition={{ duration: 0.2, ease: "easeOut" }} />}
                <Icon size={20} aria-hidden="true" />
                <span className="nav-label">{label}</span>
                {id === "insights" && reviewCount > 0 && <span className="nav-dot" aria-label={t("nav.review", { n: reviewCount })} />}
              </button>
            </Tip>
          );
        })}
        <Tip label={t("nav.voice")} enabled={!open}>
          <button className="nav-btn" aria-label={t("nav.voice")} onClick={onVoice}>
            <PhoneCall size={20} aria-hidden="true" />
            <span className="nav-label">{t("nav.voice")}</span>
          </button>
        </Tip>
        {onHistory && (
          <Tip label={t("nav.history")} enabled={!open}>
            <button className="nav-btn" aria-label={t("nav.history")} onClick={onHistory}>
              <History size={20} aria-hidden="true" />
              <span className="nav-label">{t("nav.history")}</span>
            </button>
          </Tip>
        )}
        {onSettings && (
          <Tip label={t("nav.settings")} enabled={!open}>
            <button className="nav-btn" aria-label={t("nav.settings")} onClick={onSettings}>
              <Settings size={20} aria-hidden="true" />
              <span className="nav-label">{t("nav.settings")}</span>
            </button>
          </Tip>
        )}
        <div className="nav-spacer" />
        <Tip label={t("nav.search")} enabled={!open}>
          <button className="nav-btn" aria-label={t("nav.palette")} onClick={onPalette}>
            <Search size={20} aria-hidden="true" />
            <span className="nav-label">{t("nav.searchShort")}</span>
          </button>
        </Tip>
        <button className="nav-btn nav-toggle" onClick={onToggle} aria-expanded={open} aria-label={open ? t("nav.collapse") : t("nav.expand")}>
          {open ? <ChevronsLeft size={18} aria-hidden="true" /> : <ChevronsRight size={18} aria-hidden="true" />}
          <span className="nav-label">{t("nav.collapse")}</span>
        </button>
      </nav>
    </Tooltip.Provider>
  );
}
