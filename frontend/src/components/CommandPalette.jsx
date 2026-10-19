import { Command } from "cmdk";
import { useT } from "../i18n";
import { Activity, BarChart3, LayoutDashboard, LogOut, Play, RotateCcw, ShieldAlert, PhoneCall } from "lucide-react";

export default function CommandPalette({ open, onOpenChange, calls, onSelectCall, onView, onFilter, onStartCall, onRequestReset, onLogout }) {
  const t = useT();
  const run = (fn) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={t("pal.label")}
      overlayClassName="overlay"
      contentClassName="palette"
    >
      <Command.Input placeholder={t("pal.placeholder")} className="palette-input" />
      <Command.List className="palette-list">
        <Command.Empty className="palette-empty">{t("pal.empty")}</Command.Empty>
        <Command.Group heading={t("pal.goto")}>
          <Command.Item onSelect={run(() => onView("monitor"))}><Activity size={16} aria-hidden="true" />{t("pal.monitor")}</Command.Item>
          <Command.Item onSelect={run(() => onView("command"))}><LayoutDashboard size={16} aria-hidden="true" />{t("pal.command")}</Command.Item>
          <Command.Item onSelect={run(() => onView("insights"))}><BarChart3 size={16} aria-hidden="true" />{t("pal.insights")}</Command.Item>
          <Command.Item onSelect={run(() => { onView("monitor"); onFilter("risky"); })}><ShieldAlert size={16} aria-hidden="true" />{t("pal.risky")}</Command.Item>
          <Command.Item onSelect={run(() => { onView("monitor"); onFilter("all"); })}><PhoneCall size={16} aria-hidden="true" />{t("pal.all")}</Command.Item>
        </Command.Group>
        <Command.Group heading={t("pal.actions")}>
          <Command.Item onSelect={run(onStartCall)}><Play size={16} aria-hidden="true" />{t("pal.start")}</Command.Item>
          <Command.Item onSelect={run(onRequestReset)}><RotateCcw size={16} aria-hidden="true" />{t("pal.clear")}</Command.Item>
          <Command.Item onSelect={run(onLogout)}><LogOut size={16} aria-hidden="true" />{t("pal.logout")}</Command.Item>
        </Command.Group>
        {calls.length > 0 && (
          <Command.Group heading={t("pal.calls")}>
            {calls.slice(0, 30).map((c) => (
              <Command.Item key={c.id} value={`${c.label} ${c.id} ${c.current_level}`} onSelect={run(() => { onView("monitor"); onSelectCall(c.id); })}>
                <span className={`risk-dot risk-${c.current_level}`} aria-hidden="true" />
                <span className="palette-call">{c.label}</span>
                <span className="mono palette-meta">{c.current_score} · {t(`level.${c.current_level}`)}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
