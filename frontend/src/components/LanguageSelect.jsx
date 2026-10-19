import { Languages } from "lucide-react";
import { LANGS, useI18n } from "../i18n";

/** Language dropdown. Each language is written in its own script so people can find theirs. */
export default function LanguageSelect({ className = "" }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={`lang-select ${className}`}>
      <Languages size={15} aria-hidden="true" />
      <span className="sr-only">{t("lang.label")}</span>
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t("lang.label")}>
        {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
      </select>
    </label>
  );
}
