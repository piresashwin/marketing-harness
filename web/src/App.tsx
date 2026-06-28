import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Onboarding } from "./pages/Onboarding";
import { Compose } from "./pages/Compose";
import { Brands } from "./pages/Brands";
import { BrandSettings } from "./pages/BrandSettings";
import { Settings } from "./pages/Settings";

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

  // Gate: unauthenticated → login; authed-but-not-onboarded → onboarding.
  const home = !me
    ? "/login"
    : me.user.onboardingCompleted
      ? "/compose"
      : "/onboarding";

  const requireApp = (element: React.ReactNode) =>
    !me ? (
      <Navigate to="/login" replace />
    ) : !me.user.onboardingCompleted ? (
      <Navigate to="/onboarding" replace />
    ) : (
      element
    );

  return (
    <Routes>
      <Route
        path="/login"
        element={me ? <Navigate to={home} replace /> : <Login />}
      />
      <Route
        path="/onboarding"
        element={
          !me ? (
            <Navigate to="/login" replace />
          ) : me.user.onboardingCompleted ? (
            <Navigate to="/compose" replace />
          ) : (
            <Onboarding />
          )
        }
      />
      <Route path="/compose" element={requireApp(<Compose />)} />
      <Route path="/brands" element={requireApp(<Brands />)} />
      <Route
        path="/brands/:id/settings"
        element={requireApp(<BrandSettings />)}
      />
      <Route path="/settings" element={requireApp(<Settings />)} />
      {/* Legacy path */}
      <Route path="/dashboard" element={<Navigate to="/compose" replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
