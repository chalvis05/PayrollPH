import { zodResolver } from '@hookform/resolvers/zod';
import { SetupSchema } from '@payrollph/shared';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { api, unwrap } from '../api/client';
import { Button } from '../components/Button';
import { FormError, SelectField, TextField } from '../components/forms';
import { Spinner } from '../components/Spinner';
import { useAuthRefresh, useSetupStatus } from '../lib/auth';
import { applyServerError } from '../lib/forms';
import { REGIONS } from '../lib/labels';

const SetupFormSchema = SetupSchema.extend({ confirmPassword: z.string() }).refine(
  (v) => v.password === v.confirmPassword,
  { message: 'Passwords do not match', path: ['confirmPassword'] },
);
type SetupFormIn = z.input<typeof SetupFormSchema>;
type SetupFormOut = z.output<typeof SetupFormSchema>;

/** First-run wizard: creates the owner account. Only reachable while no owner exists. */
export function SetupPage() {
  const status = useSetupStatus();
  const refresh = useAuthRefresh();
  const navigate = useNavigate();
  const { control, handleSubmit, formState, setError, setValue } = useForm<
    SetupFormIn,
    unknown,
    SetupFormOut
  >({
    resolver: zodResolver(SetupFormSchema),
    defaultValues: {
      ownerName: '',
      email: '',
      password: '',
      confirmPassword: '',
      payFrequency: 'semi_monthly',
      region: 'NCR',
    },
  });

  const adminEmail = status.data?.adminEmail;
  useEffect(() => {
    if (adminEmail) setValue('email', adminEmail);
  }, [adminEmail, setValue]);

  if (status.isPending) return <Spinner label="Loading" />;
  if (status.data && !status.data.needsSetup) return <Navigate to="/login" replace />;

  const onSubmit = async ({ confirmPassword: _c, ...body }: SetupFormOut) => {
    try {
      await unwrap(api.POST('/api/setup', { body }));
      await refresh();
      void navigate('/', { replace: true });
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <>
      <h1 className="text-xl font-semibold">Set up PayrollPH</h1>
      <p className="mt-1 mb-5 text-sm text-slate-600 dark:text-slate-400">
        Create the owner account. You can add read-only viewers later.
      </p>
      <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
        <FormError errors={formState.errors} />
        <TextField
          control={control}
          name="ownerName"
          label="Your name"
          required
          autoComplete="name"
        />
        <TextField
          control={control}
          name="email"
          label="Email"
          type="email"
          required
          autoComplete="email"
        />
        <TextField
          control={control}
          name="password"
          label="Password"
          type="password"
          hint="At least 12 characters."
          required
          autoComplete="new-password"
        />
        <TextField
          control={control}
          name="confirmPassword"
          label="Confirm password"
          type="password"
          required
          autoComplete="new-password"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="payFrequency"
            label="Pay schedule"
            options={[
              { value: 'semi_monthly', label: 'Semi-monthly (15th & end)' },
              { value: 'monthly', label: 'Monthly' },
            ]}
            required
          />
          <SelectField
            control={control}
            name="region"
            label="Region"
            hint="For minimum wage checks."
            options={REGIONS.map((r) => ({ value: r, label: r }))}
            required
          />
        </div>
        <Button type="submit" className="w-full" loading={formState.isSubmitting}>
          Create owner account
        </Button>
      </form>
    </>
  );
}
