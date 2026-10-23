import { Link } from 'react-router';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="There is nothing at this address"
        description="The link may be old or mistyped."
        action={
          <Link
            to="/"
            className="text-sm font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
          >
            Go to the dashboard
          </Link>
        }
      />
    </>
  );
}
