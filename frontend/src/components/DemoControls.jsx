import { useState } from "react";
import { FlaskConical, Plus, RotateCcw, Play } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api";
import { friendlyError } from "../lib/errors";
import { useT } from "../i18n";
import Spinner from "./Spinner";

export default function DemoControls({ onStart, onRequestReset, onLoadSamples, loadingSamples = false }) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [showPatternForm, setShowPatternForm] = useState(false);
  const [pattern, setPattern] = useState({ category: "", phrase: "", weight: 15, language: "en" });
  const [busy, setBusy] = useState(false);

  async function startCall(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onStart(label.trim() || t("demo.defaultName"));
      setLabel("");
    } finally {
      setBusy(false);
    }
  }

  async function submitPattern(e) {
    e.preventDefault();
    if (!pattern.category.trim() || !pattern.phrase.trim()) return;
    try {
      await api.addPattern(pattern.category.trim(), pattern.phrase.trim(), Number(pattern.weight), pattern.language);
    } catch (err) {
      toast.error(t("dash.actionFailed"), { description: friendlyError(t, err) });
      return;
    }
    toast.success(t("demo.patternAdded"));
    setPattern({ category: "", phrase: "", weight: 15, language: "en" });
    setShowPatternForm(false);
  }

  return (
    <div className="tools">
      <form onSubmit={startCall} className="inline">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("demo.name")} aria-label={t("demo.name")} style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{busy ? <Spinner /> : <Play size={14} aria-hidden="true" />}{t("demo.start")}</button>
      </form>

      <button type="button" className="btn btn-sm" onClick={onLoadSamples} disabled={loadingSamples} aria-busy={loadingSamples}>
        {loadingSamples ? <Spinner /> : <FlaskConical size={14} aria-hidden="true" />}{t("demo.samples")}
      </button>

      <div className="split">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowPatternForm((v) => !v)} aria-expanded={showPatternForm}>
          {!showPatternForm && <Plus size={14} aria-hidden="true" />}
          {showPatternForm ? t("demo.cancel") : t("demo.addPattern")}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onRequestReset}><RotateCcw size={14} aria-hidden="true" />{t("demo.clear")}</button>
      </div>

      {showPatternForm && (
        <form onSubmit={submitPattern} className="pattern-form">
          <input value={pattern.category} onChange={(e) => setPattern({ ...pattern, category: e.target.value })} placeholder={t("demo.category")} aria-label={t("demo.categoryAria")} />
          <input value={pattern.phrase} onChange={(e) => setPattern({ ...pattern, phrase: e.target.value })} placeholder={t("demo.phrase")} aria-label={t("demo.phraseAria")} />
          <div className="split">
            <input type="number" min={1} max={40} value={pattern.weight} onChange={(e) => setPattern({ ...pattern, weight: e.target.value })} style={{ width: 72 }} aria-label={t("demo.weight")} />
            <select value={pattern.language} onChange={(e) => setPattern({ ...pattern, language: e.target.value })} aria-label={t("demo.language")} style={{ flex: 1 }}>
              <option value="en">English</option>
              <option value="hi">{t("demo.langHindi")}</option>
            </select>
            <button className="btn btn-primary">{t("demo.add")}</button>
          </div>
        </form>
      )}
    </div>
  );
}
