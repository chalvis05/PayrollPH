import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateRatesVersionSchema,
  MinimumWageInputSchema,
  StatutoryRatesSchema,
  type StatutoryRates,
} from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { ApiError, api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import {
  DateField,
  FormError,
  MoneyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../components/forms';
import { inputClass } from '../components/forms/FieldShell';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { RatesVerifyBanner } from '../components/RatesVerifyBanner';
import { useIsOwner } from '../lib/auth';
import { cn } from '../lib/cn';
import { applyServerError } from '../lib/forms';
import { formatPeso } from '../lib/format';
import { REGIONS } from '../lib/labels';
import { formatDate, manilaToday } from '../lib/dates';

type RatesVersion = ResponseOf<'/api/rates', 'get'>[number];
type RatesData = RatesVersion['data'];
type MinWage = ResponseOf<'/api/min-wages', 'get'>[number];

/** Version metadata; the rates `data` is edited as JSON text and validated separately. */
const VersionMetaSchema = CreateRatesVersionSchema.omit({ data: true });
type MetaIn = z.input<typeof VersionMetaSchema>;
type MetaOut = z.output<typeof VersionMetaSchema>;
type WageIn = z.input<typeof MinimumWageInputSchema>;
type WageOut = z.output<typeof MinimumWageInputSchema>;

const ratesKey = ['rates'] as const;
const minWagesKey = ['min-wages'] as const;

// ------------------------------------------------------------------ display helpers

/** The version in force today: the newest one whose effective date has arrived. */
function versionInForce(versions: readonly RatesVersion[]): RatesVersion | undefined {
  const today = manilaToday();
  let best: RatesVersion | undefined;
  for (const v of versions) {
    if (v.effectiveFrom <= today && (best === undefined || v.effectiveFrom > best.effectiveFrom))
      best = v;
  }
  return best;
}

/** "0.045" -> "4.5%", by moving the decimal point in the string (no float maths). */
function percent(decimal: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(decimal)) return decimal;
  const negative = decimal.startsWith('-');
  const [whole = '0', frac = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  const padded = frac.padEnd(2, '0');
  const intPart = `${whole}${padded.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = padded.slice(2).replace(/0+$/, '');
  return `${negative ? '-' : ''}${intPart}${rest ? `.${rest}` : ''}%`;
}

function multiplier(decimal: string): string {
  return `× ${decimal}`;
}

type Fmt = 'peso' | 'percent' | 'times' | 'days' | 'months' | 'plain';

function show(value: string | number, fmt: Fmt): string {
  const s = String(value);
  switch (fmt) {
    case 'peso':
      return formatPeso(s);
    case 'percent':
      return percent(s);
    case 'times':
      return multiplier(s);
    case 'days':
      return `${s} days`;
    case 'months':
      return `${s} months`;
    default:
      return s;
  }
}

type Row = [label: string, value: string | number, fmt: Fmt];

function KeyValues({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([label, value, fmt]) => (
        <div key={label} className="contents">
          <dt className="text-slate-600 dark:text-slate-400">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{show(value, fmt)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Group({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn('rounded-md border border-slate-200 p-3 dark:border-slate-800', className)}
    >
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

const premiumLabels: Record<keyof RatesData['premiums'], string> = {
  otOrdinary: 'Overtime, ordinary day',
  otPremiumDay: 'Overtime on rest day / holiday (on that day’s rate)',
  restDay: 'Rest day',
  special: 'Special non-working day',
  specialRestDay: 'Special day on a rest day',
  regular: 'Regular holiday',
  regularRestDay: 'Regular holiday on a rest day',
  double: 'Double holiday',
  doubleRestDay: 'Double holiday on a rest day',
  nightDiff: 'Night differential',
};

const periodLabels: Record<string, string> = {
  semi_monthly: 'Semi-monthly payroll',
  monthly: 'Monthly payroll',
};

/** Read-only, grouped rendering of a rates version's `data`. */
function RatesDetail({ data }: { data: RatesData }) {
  const premiumRows = (Object.keys(premiumLabels) as (keyof RatesData['premiums'])[]).map(
    (k): Row => [premiumLabels[k], data.premiums[k], k === 'nightDiff' ? 'percent' : 'times'],
  );
  const deMinimis = Object.entries(data.benefits.deMinimis);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Group title="SSS">
        <KeyValues
          rows={[
            ['Employee rate', data.sss.eeRate, 'percent'],
            ['Employer rate', data.sss.erRate, 'percent'],
            ['Minimum MSC', data.sss.mscMin, 'peso'],
            ['Maximum MSC', data.sss.mscMax, 'peso'],
            ['MSC step', data.sss.mscStep, 'peso'],
            ['Regular SS cap (above goes to MPF)', data.sss.regularMscCap, 'peso'],
            ['EC threshold (MSC below pays low EC)', data.sss.ecThreshold, 'peso'],
            ['EC, low', data.sss.ecLow, 'peso'],
            ['EC, high', data.sss.ecHigh, 'peso'],
          ]}
        />
      </Group>
      <div className="space-y-4">
        <Group title="PhilHealth">
          <KeyValues
            rows={[
              ['Premium rate', data.philhealth.rate, 'percent'],
              ['Income floor', data.philhealth.floor, 'peso'],
              ['Income ceiling', data.philhealth.ceiling, 'peso'],
              ['Employee share of premium', data.philhealth.eeShare, 'percent'],
            ]}
          />
        </Group>
        <Group title="Pag-IBIG">
          <KeyValues
            rows={[
              ['Employee rate, at or below threshold', data.pagibig.eeRateLow, 'percent'],
              ['Employee rate, above threshold', data.pagibig.eeRateHigh, 'percent'],
              ['Low-rate threshold (monthly)', data.pagibig.lowThreshold, 'peso'],
              ['Employer rate', data.pagibig.erRate, 'percent'],
              ['Maximum compensation base', data.pagibig.maxBase, 'peso'],
            ]}
          />
        </Group>
      </div>

      <Group title="BIR withholding tax (annual brackets)" className="lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Annual income tax brackets</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  Taxable income over
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-semibold">
                  Fixed tax
                </th>
                <th scope="col" className="py-1.5 text-right font-semibold">
                  Plus, on the excess
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.bir.annualBrackets.map((b) => (
                <tr key={b.over}>
                  <td className="py-1.5 pr-3 tabular-nums">{formatPeso(b.over)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatPeso(b.base)}</td>
                  <td className="py-1.5 text-right tabular-nums">{percent(b.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <KeyValues
            rows={Object.entries(data.bir.periodsPerYear).map(([k, n]): Row => [
              `Periods per year, ${periodLabels[k] ?? k}`,
              n,
              'plain',
            ])}
          />
        </div>
      </Group>

      <Group title="Benefits and de minimis">
        <KeyValues
          rows={[
            [
              'Exempt 13th month and other benefits (per year)',
              data.benefits.otherBenefitsCeiling,
              'peso',
            ],
          ]}
        />
        {deMinimis.length > 0 ? (
          <table className="mt-3 min-w-full text-sm">
            <caption className="sr-only">De minimis benefit limits</caption>
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                <th scope="col" className="py-1.5 pr-3 font-semibold">
                  De minimis benefit
                </th>
                <th scope="col" className="py-1.5 text-right font-semibold">
                  Exempt per year
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {deMinimis.map(([key, d]) => (
                <tr key={key}>
                  <td className="py-1.5 pr-3">{d.label}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPeso(d.annualLimit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Group>

      <div className="space-y-4">
        <Group title="13th month pay">
          <KeyValues
            rows={[
              ['Divisor (months)', data.thirteenthMonth.divisor, 'plain'],
              ['Payout deadline (MM-DD)', data.thirteenthMonth.deadline, 'plain'],
            ]}
          />
        </Group>
        <Group title="Kasambahay">
          <KeyValues
            rows={[
              [
                'Employer pays the employee share below (monthly wage)',
                data.kasambahay.employerPaysEeShareBelow,
                'peso',
              ],
            ]}
          />
        </Group>
      </div>

      <Group title="Premium pay multipliers">
        <KeyValues
          rows={[
            ...premiumRows,
            [
              'Night shift window',
              `${data.nightDiffWindow.start}–${data.nightDiffWindow.end}`,
              'plain',
            ],
            ['Work hours per day', data.workHoursPerDay, 'plain'],
          ]}
        />
      </Group>

      <Group title="Leaves">
        <KeyValues
          rows={[
            ['Service incentive leave', data.leaves.silDays, 'days'],
            ['SIL after service of', data.leaves.silMinServiceMonths, 'months'],
            ['Maternity leave', data.leaves.maternityDays, 'days'],
            ['Paternity leave', data.leaves.paternityDays, 'days'],
            ['Solo parent leave', data.leaves.soloParentDays, 'days'],
            [
              'Solo parent leave after service of',
              data.leaves.soloParentMinServiceMonths,
              'months',
            ],
          ]}
        />
      </Group>
    </div>
  );
}

// ------------------------------------------------------------------ modals

function VerifyModal({ version, onClose }: { version: RatesVersion; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onVerify = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.POST('/api/rates/{id}/verify', { params: { path: { id: version.id } } }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ratesKey }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Mark ${version.version} verified?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void onVerify()}>
            I checked them — mark verified
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error ? (
          <Banner tone="danger" title="Could not mark verified">
            {error}
          </Banner>
        ) : null}
        <p>
          Before confirming, compare every figure in this version (effective{' '}
          {formatDate(version.effectiveFrom)}) against the latest official sources:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>SSS contribution schedule circular</li>
          <li>PhilHealth premium contribution advisory</li>
          <li>Pag-IBIG (HDMF) contribution circular</li>
          <li>BIR withholding tax table (revenue regulations)</li>
        </ul>
        <p>
          If anything differs, do not verify this version. Add a new version with the correct
          figures instead; existing versions are never edited.
        </p>
      </div>
    </Modal>
  );
}

interface Issue {
  path: string;
  message: string;
}

function NewVersionModal({
  template,
  onClose,
}: {
  template: RatesVersion | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const jsonId = useId();
  const [json, setJson] = useState(() =>
    template ? JSON.stringify(template.data, null, 2) : '{\n}\n',
  );
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [checked, setChecked] = useState(false);
  const { control, handleSubmit, formState, setError } = useForm<MetaIn, unknown, MetaOut>({
    resolver: zodResolver(VersionMetaSchema),
    defaultValues: { version: '', effectiveFrom: '', notes: null },
  });

  /** Parse the JSON text and validate it against StatutoryRatesSchema. */
  const validate = (): StatutoryRates | null => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (err) {
      setIssues([{ path: '(JSON)', message: err instanceof Error ? err.message : 'Invalid JSON' }]);
      setChecked(false);
      return null;
    }
    const parsed = StatutoryRatesSchema.safeParse(raw);
    if (!parsed.success) {
      setIssues(
        parsed.error.issues.map((i) => ({
          path: i.path.length > 0 ? i.path.map(String).join('.') : '(root)',
          message: i.message,
        })),
      );
      setChecked(false);
      return null;
    }
    setIssues(null);
    setChecked(true);
    return parsed.data;
  };

  const onSubmit = async (meta: MetaOut) => {
    const data = validate();
    if (!data) return;
    try {
      await unwrap(api.POST('/api/rates', { body: { ...meta, data } }));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ratesKey }),
        qc.invalidateQueries({ queryKey: ['dashboard'] }),
      ]);
      onClose();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'VALIDATION_ERROR' &&
        Array.isArray(err.details)
      ) {
        const dataIssues = (err.details as { path?: unknown; message?: unknown }[])
          .filter(
            (d): d is { path: string; message: string } =>
              typeof d.path === 'string' &&
              typeof d.message === 'string' &&
              /^\/?data(\/|$)/.test(d.path),
          )
          .map((d) => ({
            path: d.path.replace(/^\/?data\/?/, '').replaceAll('/', '.') || '(root)',
            message: d.message,
          }));
        if (dataIssues.length > 0) {
          setIssues(dataIssues);
          setChecked(false);
          return;
        }
      }
      applyServerError(err, setError);
    }
  };

  const formId = 'new-rates-version';
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a rates version"
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => void validate()}>
            Check JSON
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Add version
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A new version applies to payroll periods from its effective date. Older versions stay
          unchanged so past payrolls can be reproduced. New versions start unverified.
        </p>
        <FormError errors={formState.errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            control={control}
            name="version"
            label="Version name"
            placeholder="e.g. 2027-01"
            required
          />
          <DateField control={control} name="effectiveFrom" label="Effective from" required />
          <TextAreaField
            control={control}
            name="notes"
            label="Notes"
            hint="Which circulars this version follows."
            emptyAsNull
            className="sm:col-span-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor={jsonId}
            className="text-sm font-medium text-slate-800 dark:text-slate-200"
          >
            Rates data (JSON)
            <span className="ml-0.5 text-red-600 dark:text-red-400" aria-hidden="true">
              *
            </span>
          </label>
          <p id={`${jsonId}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
            {template
              ? `Prefilled from ${template.version}. Edit the figures that changed; rates are decimal strings (e.g. "0.05" for 5%).`
              : 'Paste the full rates object.'}
          </p>
          <textarea
            id={jsonId}
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setChecked(false);
            }}
            rows={18}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby={`${jsonId}-hint${issues ? ` ${jsonId}-issues` : ''}`}
            aria-invalid={issues !== null}
            className={cn(inputClass, 'font-mono text-xs leading-5 whitespace-pre')}
          />
        </div>
        {issues ? (
          <div id={`${jsonId}-issues`}>
            <Banner
              tone="danger"
              title={`${issues.length} problem${issues.length === 1 ? '' : 's'} in the rates data`}
            >
              <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto">
                {issues.map((i, n) => (
                  <li key={`${i.path}-${n}`}>
                    <code className="font-mono text-xs">{i.path}</code>: {i.message}
                  </li>
                ))}
              </ul>
            </Banner>
          </div>
        ) : checked ? (
          <Banner tone="info">The rates data is valid.</Banner>
        ) : null}
      </form>
    </Modal>
  );
}

function MinWageModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { control, handleSubmit, formState, setError } = useForm<WageIn, unknown, WageOut>({
    resolver: zodResolver(MinimumWageInputSchema),
    defaultValues: {
      region: 'NCR',
      effectiveFrom: '',
      nonAgricultureDaily: '',
      kasambahayMonthly: '',
      wageOrder: null,
    },
  });
  const formId = 'new-min-wage';

  const onSubmit = async (body: WageOut) => {
    try {
      await unwrap(api.POST('/api/min-wages', { body }));
      await qc.invalidateQueries({ queryKey: minWagesKey });
      onClose();
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add minimum wage"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Add minimum wage
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Copy the figures from the regional wage board&apos;s wage order. Older rows stay for past
          payrolls.
        </p>
        <FormError errors={formState.errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            control={control}
            name="region"
            label="Region"
            options={REGIONS.map((r) => ({ value: r, label: r }))}
            required
          />
          <DateField control={control} name="effectiveFrom" label="Effective from" required />
          <MoneyField
            control={control}
            name="nonAgricultureDaily"
            label="Non-agriculture, daily"
            required
          />
          <MoneyField
            control={control}
            name="kasambahayMonthly"
            label="Kasambahay, monthly"
            required
          />
          <TextField
            control={control}
            name="wageOrder"
            label="Wage order"
            placeholder="e.g. NCR-26"
            emptyAsNull
            className="sm:col-span-2"
          />
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ page

type Dialog =
  { kind: 'verify'; version: RatesVersion } | { kind: 'new-version' } | { kind: 'min-wage' } | null;

export function RatesPage() {
  const isOwner = useIsOwner();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rates = useQuery({ queryKey: ratesKey, queryFn: () => unwrap(api.GET('/api/rates')) });
  const minWages = useQuery({
    queryKey: minWagesKey,
    queryFn: () => unwrap(api.GET('/api/min-wages')),
  });

  const versions = rates.data ?? [];
  const inForce = versionInForce(versions);
  const selected = versions.find((v) => v.id === selectedId) ?? inForce ?? versions[0];
  // GET /api/rates is ordered newest effective date first: the latest version is the template.
  const latest = versions[0];

  const versionColumns: DataTableColumn<RatesVersion>[] = [
    {
      id: 'version',
      header: 'Version',
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{r.version}</span>
          {r.id === inForce?.id ? <Badge tone="info">In force</Badge> : null}
          {r.id === selected?.id ? <span className="sr-only">(shown below)</span> : null}
        </div>
      ),
    },
    { id: 'from', header: 'Effective from', cell: (r) => formatDate(r.effectiveFrom) },
    {
      id: 'verified',
      header: 'Status',
      cell: (r) =>
        r.verified ? (
          <Badge tone="success">Verified</Badge>
        ) : (
          <Badge tone="warning">Not verified</Badge>
        ),
    },
    {
      id: 'notes',
      header: 'Notes',
      hideOnMobile: true,
      cell: (r) => <span className="text-slate-600 dark:text-slate-400">{r.notes ?? '—'}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(r.id);
              document.getElementById('rates-detail')?.scrollIntoView({ behavior: 'smooth' });
            }}
            aria-label={`View ${r.version}`}
          >
            View
          </Button>
          {isOwner && !r.verified ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                setDialog({ kind: 'verify', version: r });
              }}
              aria-label={`Mark ${r.version} verified`}
            >
              Mark verified
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  const wageColumns: DataTableColumn<MinWage>[] = [
    {
      id: 'region',
      header: 'Region',
      cell: (r) => <span className="font-medium">{r.region}</span>,
    },
    { id: 'from', header: 'Effective from', cell: (r) => formatDate(r.effectiveFrom) },
    {
      id: 'daily',
      header: 'Non-agri daily',
      align: 'right',
      cell: (r) => formatPeso(r.nonAgricultureDaily),
    },
    {
      id: 'kasambahay',
      header: 'Kasambahay monthly',
      align: 'right',
      cell: (r) => formatPeso(r.kasambahayMonthly),
    },
    { id: 'order', header: 'Wage order', cell: (r) => r.wageOrder ?? '—', hideOnMobile: true },
  ];

  return (
    <>
      <PageHeader
        title="Statutory rates"
        description="Versioned SSS, PhilHealth, Pag-IBIG and BIR tables. Each payroll uses the version in force on its period."
        actions={
          isOwner ? (
            <Button onClick={() => setDialog({ kind: 'new-version' })} disabled={!rates.data}>
              Add new version
            </Button>
          ) : undefined
        }
      />
      {inForce && !inForce.verified ? (
        <RatesVerifyBanner to="/settings/rates" className="mb-6" />
      ) : null}
      {rates.data && !inForce && versions.length > 0 ? (
        <Banner tone="warning" className="mb-6">
          No rates version is in force today: every version has a future effective date.
        </Banner>
      ) : null}

      <div className="space-y-8">
        <section aria-labelledby="versions-heading" className="space-y-3">
          <h2 id="versions-heading" className="text-lg font-semibold">
            Versions
          </h2>
          {rates.error ? <Banner tone="danger">{errorMessage(rates.error)}</Banner> : null}
          <DataTable
            caption="Statutory rates versions"
            columns={versionColumns}
            rows={versions}
            rowKey={(r) => r.id}
            loading={rates.isPending}
            emptyTitle="No rates versions"
            emptyDescription="The database seed adds the first version."
          />
        </section>

        {selected ? (
          <section id="rates-detail" aria-labelledby="detail-heading" className="scroll-mt-4">
            <Card
              title={
                <span id="detail-heading">
                  {selected.version}{' '}
                  <span className="font-normal text-slate-500">
                    · effective {formatDate(selected.effectiveFrom)}
                  </span>
                </span>
              }
              actions={
                selected.verified ? (
                  <Badge tone="success">Verified</Badge>
                ) : (
                  <Badge tone="warning">Not verified</Badge>
                )
              }
            >
              {selected.notes ? (
                <p className="mb-4 text-sm whitespace-pre-line text-slate-600 dark:text-slate-400">
                  {selected.notes}
                </p>
              ) : null}
              <RatesDetail data={selected.data} />
            </Card>
          </section>
        ) : null}

        <section aria-labelledby="minwage-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="minwage-heading" className="text-lg font-semibold">
                Minimum wages
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Used to flag pay below the regional minimum and to apply kasambahay rules.
              </p>
            </div>
            {isOwner ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'min-wage' })}>
                Add minimum wage
              </Button>
            ) : null}
          </div>
          {minWages.error ? <Banner tone="danger">{errorMessage(minWages.error)}</Banner> : null}
          <DataTable
            caption="Regional minimum wages"
            columns={wageColumns}
            rows={minWages.data ?? []}
            rowKey={(r) => r.id}
            loading={minWages.isPending}
            emptyTitle="No minimum wages yet"
            emptyDescription={
              isOwner ? 'Add the current wage order for each region you employ in.' : undefined
            }
          />
        </section>
      </div>

      {dialog?.kind === 'verify' ? (
        <VerifyModal version={dialog.version} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'new-version' ? (
        <NewVersionModal template={latest} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'min-wage' ? <MinWageModal onClose={() => setDialog(null)} /> : null}
    </>
  );
}
