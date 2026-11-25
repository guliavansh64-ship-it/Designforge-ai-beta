import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const StudioHome = lazy(() => import('./pages/StudioHome'));
const Studio = lazy(() => import('./pages/Studio'));
const LogoStudio = lazy(() => import('./pages/LogoStudio'));
const Improve = lazy(() => import('./pages/Improve'));
const Projects = lazy(() => import('./pages/Projects'));
const Templates = lazy(() => import('./pages/Templates'));
const BrandKits = lazy(() => import('./pages/BrandKits'));
const ExportCenter = lazy(() => import('./pages/ExportCenter'));
const Credits = lazy(() => import('./pages/Credits'));
const Subscription = lazy(() => import('./pages/Subscription'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Settings = lazy(() => import('./pages/Settings'));
const Help = lazy(() => import('./pages/Help'));
const Admin = lazy(() => import('./pages/admin/Admin'));

const Loading = () => <div className="grid h-full min-h-[50vh] place-items-center"><Spinner className="h-8 w-8" /></div>;

function Protected({ children, admin }: { children: ReactNode; admin?: boolean }) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace />;
  if (admin && !me.user.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  const { me, loading } = useAuth();
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={loading ? <Loading /> : me ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/admin/*" element={<Protected admin><Admin /></Protected>} />
        <Route element={<Protected><Layout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="studio" element={<StudioHome mode="any" />} />
          <Route path="ui-designer" element={<StudioHome mode="ui" />} />
          <Route path="website-designer" element={<StudioHome mode="website" />} />
          <Route path="studio/:projectId" element={<Studio />} />
          <Route path="logo-studio" element={<LogoStudio />} />
          <Route path="logo-studio/:projectId" element={<LogoStudio />} />
          <Route path="improve" element={<Improve />} />
          <Route path="projects" element={<Projects />} />
          <Route path="templates" element={<Templates />} />
          <Route path="brand-kits" element={<BrandKits />} />
          <Route path="exports" element={<ExportCenter />} />
          <Route path="credits" element={<Credits />} />
          <Route path="subscription" element={<Subscription />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="settings" element={<Settings />} />
          <Route path="help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
