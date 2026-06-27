import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";

function Splash() {
  return (
    <div className="flex h-full items-center justify-center text-slate-400">
      Loading…
    </div>
  );
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Splash />;

  return (
    <Routes>
      <Route
        path="/login"
        element={me ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/onboarding"
        element={
          !me ? (
            <Navigate to="/login" replace />
          ) : me.user.onboardingCompleted ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <Onboarding />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          !me ? (
            <Navigate to="/login" replace />
          ) : !me.user.onboardingCompleted ? (
            <Navigate to="/onboarding" replace />
          ) : (
            <Dashboard />
          )
        }
      />
      <Route
        path="*"
        element={
          <Navigate
            to={
              !me
                ? "/login"
                : me.user.onboardingCompleted
                  ? "/dashboard"
                  : "/onboarding"
            }
            replace
          />
        }
      />
    </Routes>
  );
}
