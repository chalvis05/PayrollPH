import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: ReactNode | undefined;
  action?: ReactNode | undefined;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700">
      <p className="text-base font-semibold">{title}</p>
      {description !== undefined ? (
        <p className="mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">{description}</p>
      ) : null}
      {action !== undefined ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
