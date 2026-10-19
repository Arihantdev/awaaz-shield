import { useEffect, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";
import { useT } from "../i18n";

/**
 * "Add to Home Screen" help. iPhone has no install button for web apps, so people need the steps; on Android Chrome
 * the browser offers a real install prompt, which we use when it is available. Hidden once the app is installed.
 */
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export default function InstallHelp() {
  const t = useT();
  const [installed] = useState(isStandalone);
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install() {
    if (!prompt) return;
    prompt.prompt();
    try { await prompt.userChoice; } catch { /* dismissed */ }
    setPrompt(null);
  }

  return (
    <section className="vc-card">
      <h2><Download size={18} aria-hidden="true" />{t("inst.title")}</h2>
      {installed ? (
        <p className="muted" role="status">{t("inst.done")}</p>
      ) : (
        <>
          {prompt && <button className="btn btn-primary" onClick={install}><Download size={14} aria-hidden="true" />{t("inst.button")}</button>}
          {isIOS() ? (
            <ol className="set-list">
              <li>{t("inst.ios0")}</li>
              <li><Share size={14} aria-hidden="true" /> {t("inst.ios1")}</li>
              <li><SquarePlus size={14} aria-hidden="true" /> {t("inst.ios2")}</li>
              <li>{t("inst.ios3")}</li>
            </ol>
          ) : !prompt && <p className="muted">{t("inst.other")}</p>}
        </>
      )}
    </section>
  );
}
