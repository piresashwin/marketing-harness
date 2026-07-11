import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Login } from "./pages/Login";
import { Welcome } from "./pages/Welcome";
import { BrandHome } from "./pages/BrandHome";
import { Compose } from "./pages/Compose";
import { InstagramAnalytics } from "./pages/InstagramAnalytics";
import { Brands } from "./pages/Brands";
import { BrandSettings } from "./pages/BrandSettings";
import { Settings } from "./pages/Settings";
import { Plan } from "./pages/Plan";
import { Goal } from "./pages/Goal";
import { Queue } from "./pages/Queue";
import { BrandBrain } from "./pages/BrandBrain";
import { Review } from "./pages/Review";
import { ClientReview } from "./pages/ClientReview";

function Splash() {
  return (
    <div className="flex h-full items-center justify-center text-faint">
      Loading…
    </div>
  );
}

export function App() {
  const { me, loading } = useAuth();
  if (loading) return <Splash />;

  // Where to land is resolved from brand state, not a user-level flag:
  // unauthenticated → login; signed in with no brands → first-run welcome;
  // otherwise the brand home.
  const hasBrand = !!me && me.brands.length > 0;
  const home = !me ? "/login" : hasBrand ? "/home" : "/welcome";

  const requireApp = (element: React.ReactNode) =>
    !me ? (
      <Navigate to="/login" replace />
    ) : !hasBrand ? (
      <Navigate to="/welcome" replace />
    ) : (
      element
    );

  return (
    <Routes>
      {/* Public route — must render for unauthenticated visitors; placed before
          the auth-gated catch-all so it is never redirected to /login. */}
      <Route path="/review/:token" element={<ClientReview />} />

      <Route
        path="/login"
        element={me ? <Navigate to={home} replace /> : <Login />}
      />
      <Route
        path="/welcome"
        element={
          !me ? (
            <Navigate to="/login" replace />
          ) : hasBrand ? (
            <Navigate to="/home" replace />
          ) : (
            <Welcome />
          )
        }
      />
      <Route path="/home" element={requireApp(<BrandHome />)} />
      <Route path="/compose" element={requireApp(<Compose />)} />
      <Route path="/plan" element={requireApp(<Plan />)} />
      <Route path="/goal" element={requireApp(<Goal />)} />
      <Route path="/analytics" element={requireApp(<InstagramAnalytics />)} />
      <Route path="/brands" element={requireApp(<Brands />)} />
      <Route
        path="/brands/:id/settings"
        element={requireApp(<BrandSettings />)}
      />
      <Route path="/calendar" element={requireApp(<Queue />)} />
      <Route path="/brain" element={requireApp(<BrandBrain />)} />
      <Route path="/posts/:postId/review" element={requireApp(<Review />)} />
      <Route path="/settings" element={requireApp(<Settings />)} />
      {/* Legacy paths */}
      <Route path="/dashboard" element={<Navigate to={home} replace />} />
      <Route path="/onboarding" element={<Navigate to={home} replace />} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  );
}
