import { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { ShieldOff } from 'lucide-react';
import { AuthProvider, useAuth } from './auth';
import { FeedbackProvider } from './feedback';
import { ThemeProvider } from './theme';
import { Shell } from './layout/Shell';
import { APP_ROUTES } from './routes';
import { LockScreen, LoginScreen } from './pages/auth/Login';
import { ForcePasswordChange } from './pages/admin/ForcePasswordChange';
import { EmptyState, ErrorBox, Loading, Page } from './components/ui';
import { useLinkGuard } from './guards';
import type { AppRoute } from './routing';

function NoAccess() {
  return (
    <Page>
      <EmptyState icon={<ShieldOff size={36} />} title="You don't have access to this page" message="Ask the owner to give your role permission for it." />
    </Page>
  );
}

function Guard({ route }: { route: AppRoute }) {
  const { can, canAny } = useAuth();
  const ok = !route.perm || (Array.isArray(route.perm) ? canAny(route.perm) : can(route.perm));
  return (
    <Shell fullBleed={route.fullBleed}>
      <Suspense fallback={<Loading />}>{ok ? route.element : <NoAccess />}</Suspense>
    </Shell>
  );
}

function Root() {
  const { status, startError, session, locked, refresh } = useAuth();
  // Any in-app link asks "Leave without saving?" first when a form has unsaved changes.
  useLinkGuard();
  if (!status) {
    return startError ? (
      <div className="auth-screen">
        <div className="auth-card stack">
          <h1>Billforce could not start</h1>
          <ErrorBox error={startError} onRetry={() => void refresh()} />
        </div>
      </div>
    ) : (
      <Loading label="Starting Billforce…" />
    );
  }
  if (!session) return <LoginScreen />;
  if (session.mustChangePassword) return <ForcePasswordChange />;
  // While locked the page stays mounted (nothing typed is lost) but is inert: no focus, clicks or
  // screen-reader access. LockScreen also makes open dialogs inert and useHotkeys ignores every key.
  return (
    <>
      <div className="app-root" inert={locked} aria-hidden={locked || undefined}>
        <Routes>
          {APP_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={<Guard route={r} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {locked && <LockScreen />}
    </>
  );
}

export function App() {
  return (
    <HashRouter>
      <ThemeProvider>
        <FeedbackProvider>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </FeedbackProvider>
      </ThemeProvider>
    </HashRouter>
  );
}
