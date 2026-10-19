import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CallRoom from "./pages/CallRoom";
import History from "./pages/History";
import Settings from "./pages/Settings";
import ConsentGate from "./components/ConsentGate";
import useSpotlight from "./hooks/useSpotlight";

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
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/dashboard"
        element={
          <PrivateRoute>
            <ConsentGate>
              <Dashboard />
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route
        path="/call"
        element={
          <PrivateRoute>
            <ConsentGate>
              <CallRoom />
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route
        path="/history"
        element={
          <PrivateRoute>
            <ConsentGate>
              <History />
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <ConsentGate>
              <Settings />
            </ConsentGate>
          </PrivateRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
