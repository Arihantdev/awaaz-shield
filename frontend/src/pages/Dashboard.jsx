import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Toaster, toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { connectDashboardSocket } from "../ws";
import { useAuth } from "../context/AuthContext";
import { friendlyError } from "../lib/errors";
import { isHighRisk } from "../lib/risk";
import { loadSampleCalls, SAMPLE_CALLS, SAMPLE_PREFIX } from "../lib/sampleCalls";
import { useServerStatus } from "../hooks/useServerStatus";
import { signalLabel, useI18n } from "../i18n";
import TopBar from "../components/TopBar";
import NavRail from "../components/NavRail";
import CallList from "../components/CallList";
import CallDetailPanel from "../components/CallDetailPanel";
import WaveBackdrop from "../three/LazyWaveBackdrop";
import Ambient from "../components/Ambient";
import MonitorOverview from "../components/MonitorOverview";
import DemoControls from "../components/DemoControls";
import CommandPalette from "../components/CommandPalette";
import ConfirmDialog from "../components/ConfirmDialog";
import CommandCenter from "../components/command/CommandCenter";
import MobileDashboard from "../components/mobile/MobileDashboard";
import useIsMobile from "../hooks/useIsMobile";

// ECharts only downloads when the Insights view is opened.
const Insights = lazy(() => import("./Insights"));

const NAV_KEY = "awaaz.nav";
const readNavOpen = () => {
  try { return localStorage.getItem(NAV_KEY) === "open"; } catch { return false; }
};

export default function Dashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [calls, setCalls] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [view, setView] = useState("monitor");
  const [filter, setFilter] = useState("all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [navOpen, setNavOpen] = useState(readNavOpen);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const server = useServerStatus(wsStatus);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const seenAlerts = useRef(new Set());
  const { t, lang } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const langRef = useRef(lang);
  langRef.current = lang;

  const reportError = useCallback((err, title) => {
    const tt = tRef.current;
    toast.error(title || tt("dash.actionFailed"), { description: friendlyError(tt, err) });
  }, []);

  const refreshAnalytics = useCallback(() => {
    // The summary tiles are secondary; a failure here keeps the last numbers, and the live pill already shows connection trouble.
    api.analytics().then(setAnalytics).catch(() => {});
  }, []);

  const upsertCall = useCallback((call) => {
    setCalls((prev) => {
      const idx = prev.findIndex((c) => c.id === call.id);
      if (idx === -1) return [call, ...prev];
      const next = [...prev];
      next[idx] = call;
      return next;
    });
  }, []);

  useEffect(() => {
    api
      .listCalls()
      .then((list) => {
        setCalls(list);
        if (list.length > 0) setSelectedId((cur) => cur ?? list[0].id);
      })
      .catch((err) => reportError(err, tRef.current("dash.loadFailed")))
      .finally(() => setLoaded(true));
    refreshAnalytics();

    const disconnect = connectDashboardSocket((event) => {
      switch (event.type) {
        case "snapshot":
          setCalls(event.calls);
          setLoaded(true);
          if (!selectedIdRef.current && event.calls.length > 0) setSelectedId(event.calls[0].id);
          break;
        case "call_created":
        case "call_updated":
          upsertCall(event.call);
          refreshAnalytics();
          break;
        case "alert": {
          refreshAnalytics();
          const a = event.alert;
          if (a && !seenAlerts.current.has(a.id)) {
            seenAlerts.current.add(a.id);
            const label = callsRef.current.find((c) => c.id === event.call_id)?.label || tRef.current("dash.aCall");
            const body = langRef.current === "en" || !a.signals ? a.message : (a.signals.length ? tRef.current("call.alertMsg", { level: tRef.current(`level.${a.level}`), list: a.signals.map((s) => signalLabel(tRef.current, s)).join(", ") }) : tRef.current("call.alertMsgNone", { level: tRef.current(`level.${a.level}`) }));
            toast(tRef.current(a.level === "critical" ? "dash.toastCritical" : "dash.toastHigh", { label }), {
              description: body.length > 120 ? body.slice(0, 117) + "…" : body,
              className: `risk-toast risk-${a.level}`,
              duration: 9000,
              action: { label: tRef.current("dash.open"), onClick: () => { setView("monitor"); setSelectedId(event.call_id); } },
            });
          }
          break;
        }
        case "call_deleted":
          setCalls((prev) => prev.filter((c) => c.id !== event.call_id));
          setSelectedId((cur) => (cur === event.call_id ? null : cur));
          refreshAnalytics();
          break;
        case "demo_reset":
          setCalls([]);
          setSelectedId(null);
          refreshAnalytics();
          break;
        default:
          break;
      }
    }, setWsStatus);

    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl/Cmd+K opens the command palette
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleNav = useCallback(() => {
    setNavOpen((open) => {
      try { localStorage.setItem(NAV_KEY, open ? "closed" : "open"); } catch { /* storage can be blocked */ }
      return !open;
    });
  }, []);

  function refreshSelectedCall() {
    if (!selectedId) return;
    api.getCall(selectedId).then(upsertCall).catch((err) => reportError(err));
    refreshAnalytics();
  }

  async function startDemoCall(label) {
    try {
      const call = await api.createCall(label || t("demo.defaultName"), "simulated");
      setView("monitor");
      setSelectedId(call.id);
      upsertCall(call);
      api.listCalls().then(setCalls).catch(() => {});
      toast.success(t("dash.started"), { description: t("dash.startedDesc") });
    } catch (err) {
      reportError(err, t("dash.startFailed"));
    }
  }

  async function loadSamples() {
    if (loadingSamples) return;
    const have = callsRef.current.map((c) => c.label);
    if (SAMPLE_CALLS.every((s) => have.includes(SAMPLE_PREFIX + s.label))) {
      toast(t("dash.samplesExist"));
      return;
    }
    setLoadingSamples(true);
    try {
      const n = await loadSampleCalls(api, have);
      const list = await api.listCalls();
      setCalls(list);
      refreshAnalytics();
      toast.success(t("dash.samplesLoaded", { n }), { description: t("dash.samplesDesc") });
    } catch (err) {
      reportError(err, t("dash.samplesFailed"));
      api.listCalls().then(setCalls).catch(() => {});
    } finally {
      setLoadingSamples(false);
    }
  }

  async function doReset() {
    try {
      await api.resetDemo();
      setSelectedId(null);
      refreshAnalytics();
    } catch (err) {
      reportError(err);
    }
  }

  const selectedCall = calls.find((c) => c.id === selectedId) || null;
  const reviewCount = useMemo(
    () => calls.filter((c) => isHighRisk(c.current_level) && !c.disposition).length,
    [calls]
  );

  const backdropLevel = selectedCall ? selectedCall.current_level : null;

  const refreshCall = useCallback(
    (id) => {
      api.getCall(id).then(upsertCall).catch(() => {});
      refreshAnalytics();
    },
    [upsertCall, refreshAnalytics]
  );

  // The call list is shared by the Live monitor and the Command center.
  const rail = (
    <aside className="rail">
      <div className="rail-title">{t("list.title")}</div>
      <CallList calls={calls} selectedId={selectedId} onSelect={setSelectedId} filter={filter} onFilter={setFilter} loading={!loaded} />
      <DemoControls onStart={startDemoCall} onRequestReset={() => setConfirmReset(true)} onLoadSamples={loadSamples} loadingSamples={loadingSamples} />
    </aside>
  );

  if (isMobile) {
    return (
      <MobileDashboard
        calls={calls}
        loaded={loaded}
        analytics={analytics}
        wsStatus={wsStatus}
        onSelect={setSelectedId}
        onChanged={refreshSelectedCall}
        deepgramAvailable={!!server.status?.deepgram_stt}
        onStartDemo={startDemoCall}
        onLoadSamples={loadSamples}
        loadingSamples={loadingSamples}
        filter={filter}
        onFilter={setFilter}
      />
    );
  }

  return (
    <div className="app">
      <Ambient level={backdropLevel} />
      <TopBar analytics={analytics} wsStatus={wsStatus} onPalette={() => setPaletteOpen(true)} />
      <div className="shell" data-nav={navOpen ? "open" : "closed"}>
        <WaveBackdrop level={backdropLevel} />
        <NavRail view={view} onView={setView} onPalette={() => setPaletteOpen(true)} onVoice={() => navigate("/call")} onHistory={() => navigate("/history")} onSettings={() => navigate("/settings")} reviewCount={reviewCount} open={navOpen} onToggle={toggleNav} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className="view"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            {view === "monitor" ? (
              <div className="workspace">
                {rail}
                {selectedCall ? (
                  <CallDetailPanel call={selectedCall} onChanged={refreshSelectedCall} deepgramAvailable={!!server.status?.deepgram_stt} />
                ) : (
                  <MonitorOverview
                    calls={calls}
                    server={server}
                    wsStatus={wsStatus}
                    onStart={() => startDemoCall(t("demo.defaultName"))}
                    onOpenCall={setSelectedId}
                    onLoadSamples={loadSamples}
                    loadingSamples={loadingSamples}
                  />
                )}
              </div>
            ) : view === "command" ? (
              <div className="cc-workspace">
                {rail}
                <CommandCenter
                  calls={calls}
                  selectedId={selectedId}
                  wsStatus={wsStatus}
                  onChanged={refreshCall}
                  onOpenCall={(id) => { setSelectedId(id); setView("monitor"); }}
                  onError={reportError}
                />
              </div>
            ) : (
              <div className="view-scroll">
                <Suspense fallback={<div className="center-load">{t("dash.loadingInsights")}</div>}>
                  <Insights calls={calls} onOpenCall={(id) => { setSelectedId(id); setView("monitor"); }} onLoadSamples={loadSamples} loadingSamples={loadingSamples} />
                </Suspense>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        calls={calls}
        onSelectCall={setSelectedId}
        onView={setView}
        onFilter={setFilter}
        onStartCall={() => startDemoCall(t("demo.defaultName"))}
        onRequestReset={() => setConfirmReset(true)}
        onLogout={logout}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("dash.resetTitle")}
        description={t("dash.resetDesc")}
        confirmLabel={t("dash.resetConfirm")}
        danger
        onConfirm={doReset}
      />
      <Toaster position="bottom-right" theme="dark" visibleToasts={3} closeButton />
    </div>
  );
}
