import { useEffect, useState } from "react";
import { useT } from "../i18n";

// "Loading…" that, after a few seconds, explains why it is slow. On the free hosting plan the server falls asleep when
// nobody uses it and takes up to a minute to start; without this message the screen just looks broken.
export default function SlowLoad({ after = 4000, full = true }) {
  const t = useT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), after);
    return () => clearTimeout(id);
  }, [after]);
  return (
    <div className="center-load slow-load" style={full ? { height: "100vh" } : undefined} role="status" aria-live="polite">
      <span>{t("common.loading")}</span>
      {slow && <p>{t("common.waking")}</p>}
    </div>
  );
}
