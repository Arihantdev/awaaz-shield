import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Mark } from "./TopBar";
import LanguageSelect from "./LanguageSelect";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n";
import useIsMobile from "../hooks/useIsMobile";

/** Header + page frame shared by the secondary screens (History, Settings). Reuses the call-page layout. */
export default function PageShell({ title, children }) {
  const t = useT();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const mobile = useIsMobile();
  if (mobile) return <div className="m-page"><h1 className="m-title">{title}</h1>{children}</div>;
  return (
    <div className="vc-page">
      <header className="vc-top">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate("/dashboard")}>
          <ArrowLeft size={14} aria-hidden="true" />{t("voice.toDashboard")}
        </button>
        <div className="vc-brand"><Mark size={22} /><span>Awaaz Shield</span></div>
        <div className="vc-top-right"><LanguageSelect />{identity && <span className="email" title={identity.email}>{identity.email}</span>}</div>
      </header>
      <main className="vc-main">
        <h1 className="pg-title">{title}</h1>
        {children}
      </main>
    </div>
  );
}
