import { Outlet } from 'react-router';
import { ThemeToggle } from '../components/ThemeToggle';

/** Bare centred layout for pages shown before sign-in (setup wizard, login). */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="text-base font-bold tracking-tight">
          Payroll<span className="text-emerald-700 dark:text-emerald-400">PH</span>
        </span>
        <ThemeToggle className="w-48" />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
