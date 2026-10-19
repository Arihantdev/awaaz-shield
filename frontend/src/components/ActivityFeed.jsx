import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ClipboardCheck, PhoneCall, PhoneOff, ShieldAlert } from "lucide-react";
import { deriveActivity } from "../lib/risk";
import { signalLabel, useT } from "../i18n";

const ICON = { started: PhoneCall, ended: PhoneOff, alert: ShieldAlert, action: ClipboardCheck };
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const KNOWN_ACTIONS = ["flagged", "escalated", "dismissed", "note"];

/** Newest events across all calls, built from real call data only. */
export default function ActivityFeed({ calls, onOpen, limit = 8 }) {
  const t = useT();
  const items = useMemo(() => deriveActivity(calls, limit), [calls, limit]);

  if (items.length === 0) return <p className="empty-note" style={{ padding: 0 }}>{t("act.empty")}</p>;

  const describe = (e) => {
    switch (e.kind) {
      case "started": return t("act.started", { label: e.callLabel });
      case "ended": return t("act.ended", { label: e.callLabel });
      case "alert": {
        const tactics = e.signals.length ? ` · ${e.signals.map((s) => signalLabel(t, s)).join(", ")}` : "";
        return `${t("act.alert", { label: e.callLabel, level: t(`level.${e.level}`) })}${tactics}`;
      }
      default: {
        const name = KNOWN_ACTIONS.includes(e.actionType) ? t(`disp.${e.actionType}`) : e.actionType;
        return `${t("act.action", { label: e.callLabel, action: name })}${e.note ? `: ${e.note}` : ""}`;
      }
    }
  };

  return (
    <ul className="activity">
      <AnimatePresence initial={false}>
        {items.map((e) => {
          const Icon = ICON[e.kind];
          return (
            <motion.li
              key={e.id}
              layout="position"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={e.kind === "alert" ? `risk-${e.level}` : undefined}
            >
              <button type="button" className="activity-item" onClick={() => onOpen(e.callId)} aria-label={t("act.open", { label: e.callLabel })}>
                <span className={`activity-icon kind-${e.kind}`}><Icon size={14} aria-hidden="true" /></span>
                <span className="activity-text">{describe(e)}</span>
                <span className="mono activity-time">{time(e.ts)}</span>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
