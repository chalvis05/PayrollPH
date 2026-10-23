import { Link, useNavigate } from 'react-router';
import { useLogout, useMe } from '../../lib/auth';
import { Button, focusRing } from '../Button';
import { cn } from '../../lib/cn';

/** Signed-in user's name and role, a link to their account settings, and sign out. */
export function UserPanel({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe().data;
  const logout = useLogout();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <div className="flex items-center gap-2">
      <Link
        to="/account"
        onClick={onNavigate}
        className={cn(
          'min-w-0 flex-1 rounded-md px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-800',
          focusRing,
        )}
      >
        <span className="block truncate text-sm font-medium">{me.name}</span>
        <span className="block text-xs text-slate-500 capitalize dark:text-slate-400">
          {me.role}
          {me.totpEnabled ? ' · 2FA on' : ''}
        </span>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={async () => {
          await logout();
          void navigate('/login', { replace: true });
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
