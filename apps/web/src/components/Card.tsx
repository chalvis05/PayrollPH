import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

interface CardProps {
  title?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Card({ title, actions, className, children }: CardProps) {
  return (
    <section
      className={cn(
        'rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {title !== undefined || actions !== undefined ? (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          {title !== undefined ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}
