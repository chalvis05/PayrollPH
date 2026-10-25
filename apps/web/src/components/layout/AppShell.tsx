import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useMatches } from 'react-router';
import { cn } from '../../lib/cn';
import { focusRing } from '../Button';
import { ThemeToggle } from '../ThemeToggle';
import { navSections } from './nav';
import { UserPanel } from './UserPanel';
import { api, unwrap } from '../../api/client';
import { useIsEncoder, useIsOwner } from '../../lib/auth';

const SIDEBAR_KEY = 'payrollph.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_KEY, value ? '1' : '0');
  } catch {
    // Storage unavailable; the choice lasts for this tab only.
  }
}

export interface RouteHandle {
  title: string;
}

function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    typeof (value as { title: unknown }).title === 'string'
  );
}

/** Title of the deepest matched route that declares `handle: { title }`. */
export function usePageTitle(): string {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const handle: unknown = matches[i]?.handle;
    if (isRouteHandle(handle)) return handle.title;
  }
  return 'PayrollPH';
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="currentColor">
      <path d="M3 5h14a1 1 0 1 0 0-2H3a1 1 0 0 0 0 2Zm14 4H3a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2Zm0 6H3a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2Z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true" fill="currentColor">
      <path d="M5.3 5.3a1 1 0 0 1 1.4 0L10 8.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 10l3.3 3.3a1 1 0 0 1-1.4 1.4L10 11.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 10 5.3 6.7a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn('size-5 transition-transform', collapsed && 'rotate-180')}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const isOwner = useIsOwner();
  const isEncoder = useIsEncoder();
  // Same key as the Approvals page's "Waiting" list, so both share one cache entry.
  const pending = useQuery({
    queryKey: ['employee-requests', 'pending'],
    queryFn: () =>
      unwrap(api.GET('/api/employee-requests/', { params: { query: { status: 'pending' } } })),
    enabled: isOwner || isEncoder,
  });
  const pendingCount = pending.data?.length ?? 0;
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
      {navSections.map((section) => (
        <div key={section.heading} className="mb-4">
          <p
            className={cn(
              'px-2 pb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400',
              collapsed && 'sr-only',
            )}
          >
            {section.heading}
          </p>
          <ul className="space-y-0.5">
            {section.items
              .filter((item) =>
                item.approvers === true ? isOwner || isEncoder : isOwner || item.ownerOnly !== true,
              )
              .map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end === true}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium',
                        focusRing,
                        isActive
                          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
                          : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800',
                        collapsed && 'justify-center px-0',
                      )
                    }
                  >
                    {collapsed ? (
                      <>
                        <span aria-hidden="true" className="text-xs font-bold">
                          {item.label.slice(0, 2)}
                        </span>
                        <span className="sr-only">{item.label}</span>
                      </>
                    ) : (
                      <>
                        {item.label}
                        {item.to === '/approvals' && pendingCount > 0 ? (
                          <span className="ml-auto rounded-full bg-amber-500 px-2 text-xs font-semibold text-white">
                            {pendingCount}
                            <span className="sr-only"> waiting</span>
                          </span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="text-base font-bold tracking-tight">
      {compact ? 'P' : 'Payroll'}
      <span className="text-emerald-700 dark:text-emerald-400">PH</span>
    </span>
  );
}

/** Authenticated app layout: collapsible sidebar (md+), top bar + slide-over menu (phones). */
export function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const title = usePageTitle();

  useEffect(() => {
    document.title = title === 'PayrollPH' ? title : `${title} · PayrollPH`;
  }, [title]);

  // Phone menu: Esc closes, focus moves in on open and back to the button on close.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const button = menuButtonRef.current;
    drawerRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      button?.focus();
    };
  }, [menuOpen]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      writeCollapsed(!prev);
      return !prev;
    });
  };

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 dark:bg-slate-900"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] md:flex print:hidden dark:border-slate-800 dark:bg-slate-900',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex h-14 items-center border-b border-slate-200 px-3 dark:border-slate-800',
            collapsed ? 'justify-center' : 'justify-between',
          )}
        >
          {collapsed ? null : <Brand />}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn(
              'rounded-md p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100',
              focusRing,
            )}
          >
            <CollapseIcon collapsed={collapsed} />
          </button>
        </div>
        <NavLinks collapsed={collapsed} />
        {collapsed ? null : (
          <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800">
            <UserPanel />
            <ThemeToggle />
          </div>
        )}
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex h-14 print:hidden items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-900/95">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className={cn(
            '-ml-1 rounded-md p-1.5 text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800',
            focusRing,
          )}
        >
          <MenuIcon />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
        <Brand compact />
      </header>

      {/* Phone slide-over menu */}
      <div
        className={cn(
          'fixed inset-0 z-40 transition-[visibility] md:hidden',
          menuOpen ? 'visible' : 'invisible delay-200',
        )}
      >
        <div
          className={cn(
            'absolute inset-0 bg-slate-900/50 transition-opacity dark:bg-black/60',
            menuOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setMenuOpen(false)}
        />
        <div
          id="mobile-menu"
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Main menu"
          className={cn(
            'absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform dark:bg-slate-900',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
            <Brand />
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className={cn(
                'rounded-md p-1.5 text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800',
                focusRing,
              )}
            >
              <CloseIcon />
            </button>
          </div>
          <NavLinks collapsed={false} onNavigate={() => setMenuOpen(false)} />
          <div className="space-y-3 border-t border-slate-200 p-3 dark:border-slate-800">
            <UserPanel onNavigate={() => setMenuOpen(false)} />
            <ThemeToggle />
          </div>
        </div>
      </div>

      <main id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 print:max-w-none print:p-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
