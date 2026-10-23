import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ApiError, api, resetCsrf, unwrap } from '../api/client';
import { Spinner } from '../components/Spinner';

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof fetchMe>>>;

async function fetchMe() {
  try {
    const res = await unwrap(api.GET('/api/auth/me'));
    return res.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export const meQueryKey = ['auth', 'me'] as const;
export const setupStatusKey = ['setup', 'status'] as const;

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}

export function useSetupStatus() {
  return useQuery({
    queryKey: setupStatusKey,
    queryFn: () => unwrap(api.GET('/api/setup/status')),
    staleTime: Infinity,
  });
}

/** True for the owner; viewers are read-only and never see write actions. */
export function useIsOwner(): boolean {
  return useMe().data?.role === 'owner';
}

/** Refresh auth state after login, setup or logout. */
export function useAuthRefresh() {
  const qc = useQueryClient();
  return async () => {
    resetCsrf();
    await qc.invalidateQueries({ queryKey: setupStatusKey });
    await qc.resetQueries({ queryKey: meQueryKey });
  };
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await unwrap(api.POST('/api/auth/logout')).catch(() => undefined);
    resetCsrf();
    qc.clear();
  };
}

function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label="Loading" />
    </div>
  );
}

/** Gate for the app shell: first-run setup, then a signed-in session. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const setup = useSetupStatus();
  const me = useMe();
  if (setup.isPending || me.isPending) return <FullPageSpinner />;
  if (setup.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (!me.data) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}
