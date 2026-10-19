import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CallRoom from "./pages/CallRoom";
import History from "./pages/History";
import Settings from "./pages/Settings";
import ConsentGate from "./components/ConsentGate";
import useSpotlight from "./hooks/useSpotlight";
import useIsMobile from "./hooks/useIsMobile";
import MobileFrame from "./components/mobile/MobileFrame";

function PrivateRoute({ children }) {
  const { identity, checking } = useAuth();
  const location = useLocation();
  if (checking) {
    return (
      <div className="center-load" style={{ height: "100vh" }}>Loading…</div>
    );
  }
  // remember where they were going, so an invite link (/call?join=CODE) still works after signing in
  return identity ? children : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}

export default function App() {
  useSpotlight();
  const mobile = useIsMobile();
  const frame = (page) => (mobile ? <MobileFrame>{page}</MobileFrame> : page);
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <ConsentGate>
              {frame(<Dashboard />)}
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route
        path="/call"
        element={
          <PrivateRoute>
            <ConsentGate>
              {frame(<CallRoom />)}
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route
        path="/history"
        element={
          <PrivateRoute>
            <ConsentGate>
              {frame(<History />)}
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <ConsentGate>
              {frame(<Settings />)}
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
