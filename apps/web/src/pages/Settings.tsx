import { zodResolver } from '@hookform/resolvers/zod';
import { EmailSchema, SettingsSchema, SmtpSettingsSchema } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import {
  CheckboxField,
  FormError,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { RatesVerifyBanner } from '../components/RatesVerifyBanner';
import { Spinner } from '../components/Spinner';
import { useIsOwner } from '../lib/auth';
import { applyServerError } from '../lib/forms';
import { REGIONS } from '../lib/labels';
import { manilaToday } from '../lib/dates';

type SettingsDto = ResponseOf<'/api/settings', 'get'>;
type SmtpDto = ResponseOf<'/api/settings/smtp', 'get'>;
type RatesVersion = ResponseOf<'/api/rates', 'get'>[number];
type SettingsIn = z.input<typeof SettingsSchema>;
type SettingsOut = z.output<typeof SettingsSchema>;
type SmtpIn = z.input<typeof SmtpSettingsSchema>;
type SmtpOut = z.output<typeof SmtpSettingsSchema>;

/** Body of POST /api/settings/smtp/test, built from the shared email schema. */
const TestEmailSchema = z.object({ to: EmailSchema });
type TestIn = z.input<typeof TestEmailSchema>;
type TestOut = z.output<typeof TestEmailSchema>;

const settingsQueryKey = ['settings'] as const;
const smtpQueryKey = ['settings', 'smtp'] as const;

/** The rates version in force today: the newest one whose effective date has arrived. */
function versionInForce(versions: readonly RatesVersion[]): RatesVersion | undefined {
  const today = manilaToday();
  return versions
    .filter((v) => v.effectiveFrom <= today)
    .reduce<RatesVersion | undefined>(
      (best, v) => (best === undefined || v.effectiveFrom > best.effectiveFrom ? v : best),
      undefined,
    );
}

function toSettingsForm(dto: SettingsDto): SettingsIn {
  const { setupCompleted: _setup, ...rest } = dto;
  return rest;
}

function GeneralSettingsForm({ initial, readOnly }: { initial: SettingsDto; readOnly: boolean }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, formState, setError, reset } = useForm<
    SettingsIn,
    unknown,
    SettingsOut
  >({
    resolver: zodResolver(SettingsSchema),
    defaultValues: toSettingsForm(initial),
  });
  const payFrequency = useWatch({ control, name: 'payFrequency' });
  const currentRegion = useWatch({ control, name: 'defaultRegion' });

  const regionOptions = (
    (REGIONS as readonly string[]).includes(currentRegion) || currentRegion === ''
      ? [...REGIONS]
      : [currentRegion, ...REGIONS]
  ).map((r) => ({ value: r, label: r }));

  const onSubmit = async (body: SettingsOut) => {
    setSaved(false);
    try {
      const next = await unwrap(api.PUT('/api/settings', { body }));
      qc.setQueryData(settingsQueryKey, next);
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      reset(toSettingsForm(next));
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMPLOYEE_CAP_BELOW_ACTIVE') {
        setError('employeeCap', {
          type: 'server',
          message: `${err.message} Deactivate or separate employees first, or keep a higher cap.`,
        });
        return;
      }
      applyServerError(err, setError);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-6">
      <FormError errors={formState.errors} />
      {saved && !formState.isDirty ? <Banner tone="info">Settings saved.</Banner> : null}
      <fieldset disabled={readOnly} className="space-y-6">
        <Card title="Employer">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              control={control}
              name="ownerName"
              label="Employer name"
              hint="Printed on payslips and government reports."
              required
              className="sm:col-span-2"
            />
            <TextAreaField
              control={control}
              name="ownerAddress"
              label="Address"
              emptyAsNull
              className="sm:col-span-2"
            />
            <TextField
              control={control}
              name="ownerTin"
              label="TIN"
              placeholder="123-456-789-000"
              emptyAsNull
            />
            <TextField
              control={control}
              name="ownerSssEmployerNo"
              label="SSS employer no."
              emptyAsNull
            />
            <TextField
              control={control}
              name="ownerPhilhealthEmployerNo"
              label="PhilHealth employer no."
              emptyAsNull
            />
            <TextField
              control={control}
              name="ownerPagibigEmployerNo"
              label="Pag-IBIG employer no."
              emptyAsNull
            />
          </div>
        </Card>

        <Card title="Payroll">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              control={control}
              name="payFrequency"
              label="Pay frequency"
              options={[
                { value: 'semi_monthly', label: 'Semi-monthly (1–15 and 16–end)' },
                { value: 'monthly', label: 'Monthly' },
              ]}
              required
            />
            <SelectField
              control={control}
              name="defaultRegion"
              label="Default region"
              options={regionOptions}
              hint="Pre-selected for new employees; sets the minimum wage check."
              required
            />
            <SelectField
              control={control}
              name="contributionSchedule"
              label="Government contributions"
              options={[
                { value: 'second_cutoff', label: 'Deduct in full on the 2nd cutoff' },
                { value: 'split', label: 'Split 50/50 across both cutoffs' },
              ]}
              required
              className="sm:col-span-2"
            />
            <div className="text-sm text-slate-600 sm:col-span-2 dark:text-slate-400">
              {payFrequency === 'monthly' ? (
                <p>
                  With monthly pay, SSS, PhilHealth and Pag-IBIG are always deducted in full on the
                  single monthly payroll, so this choice has no effect.
                </p>
              ) : (
                <p>
                  The monthly SSS, PhilHealth and Pag-IBIG contributions are computed on the
                  month&apos;s total pay. <strong>2nd cutoff</strong> deducts all of it from the
                  16–end payroll, which keeps the computation exact. <strong>Split</strong> deducts
                  half on each cutoff for smoother take-home pay; the 2nd cutoff then settles any
                  difference once the month&apos;s total is known.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card title="Limits and backups">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              control={control}
              name="employeeCap"
              label="Employee cap"
              min={1}
              max={100}
              hint="Maximum active employees (1–100). Cannot go below today's active headcount."
              required
            />
            <NumberField
              control={control}
              name="backupRetentionDays"
              label="Keep backups for (days)"
              min={1}
              max={365}
              hint="Nightly backups older than this are deleted automatically."
              required
            />
          </div>
        </Card>
      </fieldset>

      {readOnly ? null : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!formState.isDirty} onClick={() => reset()}>
            Discard changes
          </Button>
          <Button type="submit" loading={formState.isSubmitting}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

function toSmtpForm(dto: SmtpDto): SmtpIn {
  return {
    host: dto.host ?? '',
    port: dto.port ?? 587,
    secure: dto.secure,
    username: dto.username,
    password: null,
    fromAddress: dto.fromAddress ?? '',
  };
}

function SmtpForm({ initial }: { initial: SmtpDto }) {
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const { control, handleSubmit, formState, setError, reset } = useForm<SmtpIn, unknown, SmtpOut>({
    resolver: zodResolver(SmtpSettingsSchema),
    defaultValues: toSmtpForm(initial),
  });

  const onSubmit = async (body: SmtpOut) => {
    setSaved(false);
    try {
      await unwrap(api.PUT('/api/settings/smtp', { body }));
      const fresh = await qc.fetchQuery({
        queryKey: smtpQueryKey,
        queryFn: () => unwrap(api.GET('/api/settings/smtp')),
        staleTime: 0,
      });
      reset(toSmtpForm(fresh));
      setSaved(true);
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
      <FormError errors={formState.errors} />
      {saved && !formState.isDirty ? <Banner tone="info">SMTP settings saved.</Banner> : null}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <TextField
          control={control}
          name="host"
          label="SMTP host"
          placeholder="smtp.example.com"
          autoComplete="off"
          required
        />
        <NumberField control={control} name="port" label="Port" min={1} max={65535} required />
      </div>
      <CheckboxField
        control={control}
        name="secure"
        label="Use TLS from the start (SMTPS)"
        hint="Usually on for port 465. Leave off for port 587, which upgrades with STARTTLS."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          control={control}
          name="username"
          label="Username"
          autoComplete="off"
          emptyAsNull
        />
        <TextField
          control={control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder={initial.hasPassword ? 'unchanged' : undefined}
          hint={
            initial.hasPassword
              ? 'A password is saved. Leave blank to keep it.'
              : 'Leave blank if the server needs no password.'
          }
          emptyAsNull
        />
      </div>
      <TextField
        control={control}
        name="fromAddress"
        label="From address"
        type="email"
        placeholder="payroll@example.com"
        hint="Payslip emails are sent from this address."
        required
      />
      <div className="flex justify-end">
        <Button type="submit" loading={formState.isSubmitting}>
          Save SMTP settings
        </Button>
      </div>
    </form>
  );
}

function TestEmailForm({ configured }: { configured: boolean }) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { control, handleSubmit, formState, setError } = useForm<TestIn, unknown, TestOut>({
    resolver: zodResolver(TestEmailSchema),
    defaultValues: { to: '' },
  });

  const onSubmit = async (body: TestOut) => {
    setSentTo(null);
    try {
      await unwrap(api.POST('/api/settings/smtp/test', { body }));
      setSentTo(body.to);
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
    >
      <h3 className="text-sm font-semibold">Send a test email</h3>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Uses the <em>saved</em> settings above. Save any changes first.
      </p>
      <FormError errors={formState.errors} />
      {sentTo ? (
        <Banner tone="info">Test email sent to {sentTo}. Check that inbox (and spam).</Banner>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          control={control}
          name="to"
          label="Send to"
          type="email"
          autoComplete="email"
          disabled={!configured}
          className="flex-1"
          required
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!configured}
          loading={formState.isSubmitting}
        >
          Send test email
        </Button>
      </div>
    </form>
  );
}

function SmtpCard() {
  const smtp = useQuery({
    queryKey: smtpQueryKey,
    queryFn: () => unwrap(api.GET('/api/settings/smtp')),
  });
  return (
    <Card
      title="Email (SMTP)"
      actions={
        smtp.data ? (
          <Badge tone={smtp.data.configured ? 'success' : 'warning'}>
            {smtp.data.configured ? 'Configured' : 'Not set up'}
          </Badge>
        ) : undefined
      }
    >
      {smtp.isPending ? (
        <Spinner label="Loading SMTP settings" />
      ) : smtp.error ? (
        <Banner tone="danger">{errorMessage(smtp.error)}</Banner>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Used to email payslips to employees. The password is stored encrypted and never shown
            again.
          </p>
          <SmtpForm initial={smtp.data} />
          <TestEmailForm configured={smtp.data.configured} />
        </div>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const isOwner = useIsOwner();
  const settings = useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => unwrap(api.GET('/api/settings')),
  });
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => unwrap(api.GET('/api/rates')) });
  const inForce = rates.data ? versionInForce(rates.data) : undefined;

  return (
    <>
      <PageHeader
        title="Settings"
        description={
          isOwner
            ? 'Employer details, pay schedule, employee cap and email settings.'
            : 'Employer details and pay schedule. Viewers cannot change settings.'
        }
      />
      {inForce && !inForce.verified ? (
        <RatesVerifyBanner to="/settings/rates" className="mb-6" />
      ) : null}
      <div className="space-y-6">
        {settings.isPending ? (
          <Spinner label="Loading settings" />
        ) : settings.error ? (
          <Banner tone="danger">{errorMessage(settings.error)}</Banner>
        ) : (
          <GeneralSettingsForm initial={settings.data} readOnly={!isOwner} />
        )}
        {isOwner ? <SmtpCard /> : null}
      </div>
    </>
  );
}
