import type { ReactNode } from 'react';
import { PageHeader } from '../components/PageHeader';

interface PlaceholderProps {
  title: string;
  description?: string | undefined;
  banner?: ReactNode | undefined;
  children?: ReactNode | undefined;
}

/** Temporary page body until the screen is wired to the API. */
export function Placeholder({ title, description, banner, children }: PlaceholderProps) {
  return (
    <>
      <PageHeader title={title} description={description} />
      {banner !== undefined ? <div className="mb-6">{banner}</div> : null}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        This screen is coming in Phase 4.
      </p>
      {children !== undefined ? <div className="mt-6">{children}</div> : null}
    </>
  );
}
