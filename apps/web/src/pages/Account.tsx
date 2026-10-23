import { zodResolver } from '@hookform/resolvers/zod';
import { ChangePasswordSchema, TotpVerifySchema } from '@payrollph/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { FormError, TextField } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { meQueryKey, useMe } from '../lib/auth';
import { applyServerError } from '../lib/forms';

const PasswordFormSchema = ChangePasswordSchema.extend({ confirm: z.string() }).refine(
  (v) => v.newPassword === v.confirm,
  { message: 'Passwords do not match', path: ['confirm'] },
);
type PasswordIn = z.input<typeof PasswordFormSchema>;
type PasswordOut = z.output<typeof PasswordFormSchema>;
type CodeIn = z.input<typeof TotpVerifySchema>;
type CodeOut = z.output<typeof TotpVerifySchema>;

function PasswordCard() {
  const [done, setDone] = useState(false);
  const { control, handleSubmit, formState, setError, reset } = useForm<
    PasswordIn,
    unknown,
    PasswordOut
  >({
    resolver: zodResolver(PasswordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  return (
    <Card title="Password">
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) =>
          void handleSubmit(async ({ confirm: _c, ...body }) => {
            try {
              await unwrap(api.POST('/api/auth/password', { body }));
              reset();
              setDone(true);
            } catch (err) {
              applyServerError(err, setError);
            }
          })(e)
        }
      >
        <FormError errors={formState.errors} />
        {done ? (
          <Banner tone="info">Password changed. Other devices have been signed out.</Banner>
        ) : null}
        <TextField
          control={control}
          name="currentPassword"
          label="Current password"
          type="password"
          required
          autoComplete="current-password"
        />
        <TextField
          control={control}
          name="newPassword"
          label="New password"
          type="password"
          hint="At least 12 characters."
          required
          autoComplete="new-password"
        />
        <TextField
          control={control}
          name="confirm"
          label="Confirm new password"
          type="password"
          required
          autoComplete="new-password"
        />
        <Button type="submit" loading={formState.isSubmitting}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const [enrollment, setEnrollment] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { control, handleSubmit, formState, setError, reset } = useForm<CodeIn, unknown, CodeOut>({
    resolver: zodResolver(TotpVerifySchema),
    defaultValues: { code: '' },
  });

  const submitCode = (path: '/api/auth/totp/enable' | '/api/auth/totp/disable') =>
    handleSubmit(async (body) => {
      try {
        await unwrap(api.POST(path, { body }));
        reset();
        setEnrollment(null);
        await qc.invalidateQueries({ queryKey: meQueryKey });
      } catch (err) {
        applyServerError(err, setError);
      }
    });

  return (
    <Card title="Two-factor authentication">
      {enabled ? (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => void submitCode('/api/auth/totp/disable')(e)}
        >
          <p className="text-sm text-slate-600 dark:text-slate-400">
            2FA is on. Enter a current code to turn it off.
          </p>
          <FormError errors={formState.errors} />
          <TextField
            control={control}
            name="code"
            label="Authenticator code"
            autoComplete="one-time-code"
            required
          />
          <Button type="submit" variant="danger" loading={formState.isSubmitting}>
            Turn off 2FA
          </Button>
        </form>
      ) : enrollment ? (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => void submitCode('/api/auth/totp/enable')(e)}
        >
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Scan this QR code with an authenticator app, then enter the 6-digit code it shows.
          </p>
          <img
            src={enrollment.qrDataUrl}
            alt="QR code for your authenticator app"
            className="size-44 rounded bg-white p-2"
          />
          <p className="text-xs break-all text-slate-500">
            Can&apos;t scan? Enter this key: <code className="font-mono">{enrollment.secret}</code>
          </p>
          <FormError errors={formState.errors} />
          <TextField
            control={control}
            name="code"
            label="Code from the app"
            autoComplete="one-time-code"
            required
          />
          <div className="flex gap-2">
            <Button type="submit" loading={formState.isSubmitting}>
              Turn on 2FA
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEnrollment(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Add a one-time code from an authenticator app to every sign-in.
          </p>
          {startError ? <Banner tone="danger">{startError}</Banner> : null}
          <Button
            onClick={async () => {
              setStartError(null);
              try {
                const res = await unwrap(api.POST('/api/auth/totp/setup'));
                setEnrollment({ secret: res.secret, qrDataUrl: res.qrDataUrl });
              } catch (err) {
                setStartError(errorMessage(err));
              }
            }}
          >
            Set up 2FA
          </Button>
        </div>
      )}
    </Card>
  );
}

export function AccountPage() {
  const me = useMe().data;
  if (!me) return null;
  return (
    <>
      <PageHeader title="My account" description={`${me.name} · ${me.email} · ${me.role}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <PasswordCard />
        <TwoFactorCard enabled={me.totpEnabled} />
      </div>
    </>
  );
}
