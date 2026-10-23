import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema } from '@payrollph/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { ApiError, api, unwrap } from '../api/client';
import { Button } from '../components/Button';
import { FormError, TextField } from '../components/forms';
import { Spinner } from '../components/Spinner';
import { useAuthRefresh, useMe, useSetupStatus } from '../lib/auth';
import { applyServerError } from '../lib/forms';

type LoginIn = z.input<typeof LoginSchema>;
type LoginOut = z.output<typeof LoginSchema>;

/** Only follow same-site relative paths after login (no open redirects). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const setup = useSetupStatus();
  const me = useMe();
  const refresh = useAuthRefresh();
  const navigate = useNavigate();
  const [needsCode, setNeedsCode] = useState(false);
  const { control, handleSubmit, formState, setError, setValue } = useForm<
    LoginIn,
    unknown,
    LoginOut
  >({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  if (setup.isPending || me.isPending) return <Spinner label="Loading" />;
  if (setup.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (me.data) return <Navigate to={next} replace />;

  const onSubmit = async ({ totpCode, ...creds }: LoginOut) => {
    const body = totpCode ? { ...creds, totpCode } : creds;
    try {
      await unwrap(api.POST('/api/auth/login', { body }));
      await refresh();
      void navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOTP_REQUIRED') {
        setNeedsCode(true);
        return;
      }
      if (err instanceof ApiError && err.code === 'INVALID_TOTP') {
        setValue('totpCode', '');
        setError('totpCode', { message: err.message });
        return;
      }
      applyServerError(err, setError);
    }
  };

  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Sign in</h1>
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormError errors={formState.errors} />
        <TextField
          control={control}
          name="email"
          label="Email"
          type="email"
          required
          autoComplete="username"
        />
        <TextField
          control={control}
          name="password"
          label="Password"
          type="password"
          required
          autoComplete="current-password"
        />
        {needsCode ? (
          <TextField
            control={control}
            name="totpCode"
            label="Authenticator code"
            hint="The 6-digit code from your authenticator app."
            required
            autoComplete="one-time-code"
          />
        ) : null}
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
    </>
  );
}
