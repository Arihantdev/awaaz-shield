import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { Mark } from "../components/TopBar";
import LanguageSelect from "../components/LanguageSelect";
import { useT } from "../i18n";

const ShieldField = lazy(() => import("../three/ShieldField"));
import {
  auth,
  firebaseConfigured,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  firebaseSignOut,
  authDomain,
} from "../firebase";

export default function Login() {
  const t = useT();
  const { setIdentity } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from;

  const [backendStatus, setBackendStatus] = useState(null);
  const [mode, setMode] = useState("signin"); // signin | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false); // show the "resend email" help
  const [cooldown, setCooldown] = useState(0);
  const rootRef = useRef(null);

  // entrance: card and headline settle in after the shield starts to form (skipped for reduced motion)
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const ctx = gsap.context(() => {
      gsap.from(".login-hero > *", { y: 18, opacity: 0, duration: 0.9, stagger: 0.12, delay: 1.4, ease: "power3.out" });
      gsap.from(".login-card", { y: 26, opacity: 0, duration: 0.9, delay: 0.9, ease: "power3.out" });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    api
      .status()
      .then(setBackendStatus)
      .catch(() => setBackendStatus({ firebase_auth: false, dev_mode_auth: true }));
  }, []);

  const useRealAuth = firebaseConfigured && backendStatus?.firebase_auth;

  async function handleDevLogin(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const identity = await api.devLogin(email || "demo.operator@example.com");
      setIdentity(identity);
      navigate(typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Friendly text for the Firebase errors people actually hit.
  function friendly(err) {
    const code = err?.code || "";
    if (code.includes("email-already-in-use")) return t("login.err.exists");
    if (code.includes("weak-password")) return t("login.err.weak");
    if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-login")) return t("login.err.bad");
    if (code.includes("too-many-requests")) return t("login.err.many");
    if (code.includes("invalid-email")) return t("login.err.email");
    return String(err?.message || err).replace("Firebase: ", "");
  }

  // Send the verification email. Tries with a link back to this app first; if Firebase rejects that
  // address (not in Authorized domains) it retries with Firebase's default link so the email still goes out.
  async function sendVerification(user) {
    try {
      await sendEmailVerification(user, { url: `${window.location.origin}/login`, handleCodeInApp: false });
    } catch (err) {
      if (String(err?.code || "").includes("continue-uri") || String(err?.code || "").includes("invalid-continue")) {
        await sendEmailVerification(user);
      } else {
        throw err;
      }
    }
  }

  function startCooldown() {
    setCooldown(60);
    const id = setInterval(() => setCooldown((c) => { if (c <= 1) { clearInterval(id); return 0; } return c - 1; }), 1000);
  }

  async function handleFirebaseSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "register") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const verifyRequired = backendStatus?.email_verification_required !== false;
        if (verifyRequired) {
          try {
            await sendVerification(cred.user);
            setInfo(t("login.accountCreated"));
            startCooldown();
          } catch (err) {
            setError(`${t("login.err.sendFail")} ${friendly(err)}`);
          }
          setNeedsVerify(true);
          await firebaseSignOut(auth);
          setMode("signin");
          return;
        }
      }

      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (backendStatus?.email_verification_required !== false && !cred.user.emailVerified) {
        setError(t("login.verifyFirst"));
        setNeedsVerify(true);
        await firebaseSignOut(auth);
        return;
      }
      const idToken = await cred.user.getIdToken();
      const identity = await api.exchangeFirebaseToken(idToken);
      setIdentity(identity);
      navigate(typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard");
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  // "Didn't get the email?" - signs in with the typed email + password and sends a fresh verification email.
  async function handleResendVerification() {
    setError("");
    setInfo("");
    if (!email || !password) {
      setError(t("login.resendNeeds"));
      return;
    }
    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      if (cred.user.emailVerified) {
        setInfo(t("login.alreadyVerified"));
      } else {
        await sendVerification(cred.user);
        setInfo(t("login.resendSent"));
        startCooldown();
      }
      await firebaseSignOut(auth);
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword() {
    setError("");
    setInfo("");
    if (!email) {
      setError(t("login.enterEmailFirst"));
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo(t("login.resetSent"));
    } catch (err) {
      setError(friendly(err));
    }
  }

  return (
    <div className="login" ref={rootRef}>
      <div className="field">
        <Suspense fallback={null}>
          <ShieldField />
        </Suspense>
      </div>
      <div className="login-hero">
        <h2>{t("login.headline")}</h2>
        <p>{t("login.sub")}</p>
      </div>
      <div className="login-card">
        <LanguageSelect className="login-lang" />
        <Mark size={36} />
        <h1>Awaaz Shield</h1>
        <p className="tag">{t("login.tag")}</p>

        {backendStatus === null ? (
          <p style={{ color: "var(--text-dim)", marginTop: 24 }}>{t("login.checking")}</p>
        ) : useRealAuth ? (
          <form onSubmit={handleFirebaseSubmit} className="form">
            <label>
              {t("login.email")}
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              {t("login.password")}
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && <p className="msg-error" role="alert">{error}</p>}
            {info && <p className="msg-info" role="status">{info}</p>}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {mode === "signin" ? t("login.signIn") : t("login.createAccount")}
            </button>

            {needsVerify && (
              <div className="verify-help" role="note">
                <p>{t("login.spamHint", { sender: `noreply@${authDomain || "your-project.firebaseapp.com"}` })}</p>
                <button type="button" className="btn btn-sm" disabled={busy || cooldown > 0} onClick={handleResendVerification}>
                  {cooldown > 0 ? t("login.resendWait", { n: cooldown }) : t("login.resend")}
                </button>
              </div>
            )}

            <div className="links">
              <button type="button" className="linkbtn" onClick={() => setMode(mode === "signin" ? "register" : "signin")}>
                {mode === "signin" ? t("login.needAccount") : t("login.haveAccount")}
              </button>
              <button type="button" className="linkbtn" onClick={handleResetPassword}>{t("login.forgot")}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleDevLogin} className="form">
            <p className="dev-notice">
              {t("login.devNotice")}
            </p>
            <label>
              {t("login.operatorEmail")}
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="operator@example.com" />
            </label>
            {error && <p className="msg-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{t("login.enterDev")}</button>
          </form>
        )}
      </div>
    </div>
  );
}
