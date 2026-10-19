import { useT } from "../i18n";

export default function RiskBadge({ score, level }) {
  const t = useT();
  return (
    <span className={`risk-pill risk-${level}`}>
      <span className="risk-dot" />
      {score}
      <span className="lvl">{t(`level.${level}`)}</span>
    </span>
  );
}
