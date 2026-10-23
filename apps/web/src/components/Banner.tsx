import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BannerTone = 'info' | 'warning' | 'danger';

interface BannerProps {
  tone?: BannerTone | undefined;
  title?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}

const toneClasses: Record<BannerTone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-100',
  danger:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/60 dark:text-red-100',
};

const toneIcon: Record<BannerTone, string> = { info: 'i', warning: '!', danger: '!' };

export function Banner({ tone = 'info', title, children, className }: BannerProps) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-3 text-sm', toneClasses[tone], className)}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
      >
        {toneIcon[tone]}
      </span>
      <div className="min-w-0">
        {title !== undefined ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
