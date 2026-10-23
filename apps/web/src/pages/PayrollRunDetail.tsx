import { zodResolver } from '@hookform/resolvers/zod';
import { ReopenPayrollRunSchema, type WarningCode } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import type { z } from 'zod';
import { ApiError, api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button, buttonClass, focusRing } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { FormError, TextAreaField } from '../components/forms';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { RatesVerifyBanner } from '../components/RatesVerifyBanner';
import { Spinner } from '../components/Spinner';
import { useIsOwner } from '../lib/auth';
import { formatPeso } from '../lib/format';
import { applyServerError } from '../lib/forms';
import { runKindLabels } from '../lib/labels';
import { RunStatusBadge } from './PayrollRuns';
import { formatDate, formatPeriod } from '../lib/dates';

type RunDetail = ResponseOf<'/api/payroll-runs/{id}', 'get'>;
type SlipRow = RunDetail['payslips'][number];
type EmailResult = ResponseOf<'/api/payroll-runs/{id}/payslips/email', 'post'>;

export const warningLabels: Record<WarningCode, string> = {
  below_minimum_wage: 'Below minimum wage',
  missing_gov_ids: 'Missing government IDs',
  negative_net: 'Negative net pay',
  kasambahay_employer_shoulders_ee: 'Employer pays kasambahay share',
  unknown_de_minimis_type: 'Unknown de minimis type',
};

const severityTone = { info: 'info', warning: 'warning', error: 'danger' } as const;

const linkClass = `font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400 ${focusRing}`;

const slipColumns: DataTableColumn<SlipRow>[] = [
  {
    id: 'employee',
    header: 'Employee',
    cell: (r) => (
      <div>
        <Link to={`/payslips/${r.id}`} className={linkClass}>
          {r.employeeName}
        </Link>
        <div className="text-xs text-slate-500 dark:text-slate-400">{r.employeeNo}</div>
      </div>
    ),
  },
  { id: 'gross', header: 'Gross', align: 'right', cell: (r) => formatPeso(r.gross) },
  {
    id: 'deductions',
    header: 'Deductions',
    align: 'right',
    cell: (r) => formatPeso(r.totalDeductions),
  },
  {
    id: 'net',
    header: 'Net',
    align: 'right',
    cell: (r) => <span className="font-semibold">{formatPeso(r.net)}</span>,
  },
  {
    id: 'er',
    header: 'Employer shares',
    align: 'right',
    cell: (r) => formatPeso(r.employerShares),
    hideOnMobile: true,
  },
  {
    id: 'warnings',
    header: 'Warnings',
    cell: (r) =>
      r.warnings.length === 0 ? (
        <span className="text-slate-400">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {r.warnings.map((w, i) => (
            <span key={`${w.code}-${i}`} title={w.message}>
              <Badge tone={severityTone[w.severity]}>{warningLabels[w.code]}</Badge>
            </span>
          ))}
        </div>
      ),
  },
];

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 text-lg tabular-nums sm:text-xl ${emphasis ? 'font-bold text-emerald-700 dark:text-emerald-400' : 'font-semibold'}`}
      >
        {formatPeso(value)}
      </p>
    </div>
  );
}

function ConfirmModal({
  title,
  confirmLabel,
  variant = 'primary',
  busy,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={variant} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-700 dark:text-slate-300">{children}</div>
    </Modal>
  );
}

type ReopenIn = z.input<typeof ReopenPayrollRunSchema>;
type ReopenOut = z.output<typeof ReopenPayrollRunSchema>;

function ReopenModal({
  runId,
  onDone,
  onClose,
}: {
  runId: string;
  onDone: (run: RunDetail) => Promise<void>;
  onClose: () => void;
}) {
  const formId = useId();
  const { control, handleSubmit, formState, setError } = useForm<ReopenIn, unknown, ReopenOut>({
    resolver: zodResolver(ReopenPayrollRunSchema),
    defaultValues: { reason: '' },
  });
  const onSubmit = async (body: ReopenOut) => {
    try {
      const run = await unwrap(
        api.POST('/api/payroll-runs/{id}/reopen', { params: { path: { id: runId } }, body }),
      );
      await onDone(run);
      onClose();
    } catch (err) {
      applyServerError(err, setError);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Reopen payroll run"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={formState.isSubmitting}>
            Reopen to draft
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
        <p className="text-sm text-slate-700 dark:text-slate-300">
          Reopening returns the run to draft: loan payments it posted are reversed, one-off
          deductions are released, attendance for the period is unlocked, and a final-pay employee
          goes back to inactive. The reason is kept in the audit log.
        </p>
        <FormError errors={formState.errors} />
        <TextAreaField control={control} name="reason" label="Reason" required rows={3} />
      </form>
    </Modal>
  );
}

function EmailResultView({ result, run }: { result: EmailResult; run: RunDetail }) {
  const nameOf = (employeeId: string) =>
    run.payslips.find((p) => p.employeeId === employeeId)?.employeeName ?? employeeId;
  const skipReason = { no_email: 'no email on file', not_in_run: 'not in this run' } as const;
  return (
    <Banner
      tone={result.failed.length > 0 ? 'warning' : 'info'}
      title={`Sent ${result.sent.length}, skipped ${result.skipped.length}, failed ${result.failed.length}`}
    >
      <ul className="mt-1 space-y-1">
        {result.sent.length > 0 ? (
          <li>
            <span className="font-medium">Sent:</span>{' '}
            {result.sent.map((s) => `${nameOf(s.employeeId)} (${s.to})`).join(', ')}
          </li>
        ) : null}
        {result.skipped.length > 0 ? (
          <li>
            <span className="font-medium">Skipped:</span>{' '}
            {result.skipped
              .map((s) => `${nameOf(s.employeeId)} (${skipReason[s.reason]})`)
              .join(', ')}
          </li>
        ) : null}
        {result.failed.length > 0 ? (
          <li>
            <span className="font-medium">Failed:</span>{' '}
            {result.failed.map((f) => `${nameOf(f.employeeId)}: ${f.message}`).join('; ')}
          </li>
        ) : null}
      </ul>
    </Banner>
  );
}

type Dialog = 'delete' | 'approve' | 'reopen' | null;
type Busy = 'recompute' | 'submit' | 'return' | 'approve' | 'mark-paid' | 'delete' | 'email' | null;

export function PayrollRunDetailPage() {
  const { id = '' } = useParams();
  const isOwner = useIsOwner();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [emailResult, setEmailResult] = useState<EmailResult | null>(null);

  const query = useQuery({
    queryKey: ['payroll-run', id],
    queryFn: () => unwrap(api.GET('/api/payroll-runs/{id}', { params: { path: { id } } })),
    enabled: id !== '',
  });
  const run = query.data;

  if (query.isPending) return <Spinner label="Loading payroll run" />;
  if (query.error || !run) {
    return (
      <Banner tone="danger">
        {query.error ? errorMessage(query.error) : 'Payroll run not found.'}
      </Banner>
    );
  }

  const params = { params: { path: { id } } };

  const applyRun = async (next: RunDetail) => {
    qc.setQueryData(['payroll-run', id], next);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['payroll-runs'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
      qc.invalidateQueries({ queryKey: ['loans'] }),
      qc.invalidateQueries({ queryKey: ['employees'] }),
      qc.invalidateQueries({ queryKey: ['payslip'] }),
    ]);
  };

  const act = async (name: Exclude<Busy, null>, call: () => Promise<RunDetail>) => {
    setBusy(name);
    setActionError(null);
    setEmailResult(null);
    try {
      await applyRun(await call());
      setDialog(null);
    } catch (err) {
      setActionError(err);
      setDialog(null);
      // A 409 usually means the run changed elsewhere; show its current state.
      if (err instanceof ApiError && err.status === 409) void query.refetch();
    } finally {
      setBusy(null);
    }
  };

  const recompute = () =>
    act('recompute', () => unwrap(api.POST('/api/payroll-runs/{id}/recompute', params)));
  const submit = () =>
    act('submit', () => unwrap(api.POST('/api/payroll-runs/{id}/submit', params)));
  const returnToDraft = () =>
    act('return', () => unwrap(api.POST('/api/payroll-runs/{id}/return', params)));
  const approve = () =>
    act('approve', () => unwrap(api.POST('/api/payroll-runs/{id}/approve', params)));
  const markPaid = () =>
    act('mark-paid', () => unwrap(api.POST('/api/payroll-runs/{id}/mark-paid', params)));

  const remove = async () => {
    setBusy('delete');
    setActionError(null);
    try {
      await unwrap(api.DELETE('/api/payroll-runs/{id}', params));
      qc.removeQueries({ queryKey: ['payroll-run', id] });
      await qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      void navigate('/payroll');
    } catch (err) {
      setActionError(err);
      setDialog(null);
      setBusy(null);
    }
  };

  const emailPayslips = async () => {
    setBusy('email');
    setActionError(null);
    setEmailResult(null);
    try {
      setEmailResult(
        await unwrap(api.POST('/api/payroll-runs/{id}/payslips/email', { ...params, body: {} })),
      );
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  const posted = run.status === 'approved' || run.status === 'paid';
  const canRecompute = run.kind !== 'final_pay';
  const isRegularKind =
    run.kind === 'semi_monthly_1' || run.kind === 'semi_monthly_2' || run.kind === 'monthly';
  const disabled = busy !== null;

  const actions: ReactNode = isOwner ? (
    <>
      {run.status === 'draft' ? (
        <>
          {canRecompute ? (
            <Button
              variant="secondary"
              loading={busy === 'recompute'}
              disabled={disabled}
              onClick={() => void recompute()}
            >
              Recompute
            </Button>
          ) : null}
          <Button
            variant="danger"
            disabled={disabled}
            onClick={() => {
              setActionError(null);
              setDialog('delete');
            }}
          >
            Delete
          </Button>
          <Button loading={busy === 'submit'} disabled={disabled} onClick={() => void submit()}>
            Submit for review
          </Button>
        </>
      ) : null}
      {run.status === 'review' ? (
        <>
          <Button
            variant="secondary"
            loading={busy === 'return'}
            disabled={disabled}
            onClick={() => void returnToDraft()}
          >
            Return to draft
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              setActionError(null);
              setDialog('approve');
            }}
          >
            Approve
          </Button>
        </>
      ) : null}
      {posted ? (
        <>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setActionError(null);
              setDialog('reopen');
            }}
          >
            Reopen
          </Button>
          {run.status === 'approved' ? (
            <Button
              loading={busy === 'mark-paid'}
              disabled={disabled}
              onClick={() => void markPaid()}
            >
              Mark paid
            </Button>
          ) : null}
        </>
      ) : null}
    </>
  ) : undefined;

  const warningCounts = new Map<WarningCode, number>();
  for (const slip of run.payslips) {
    for (const w of slip.warnings) warningCounts.set(w.code, (warningCounts.get(w.code) ?? 0) + 1);
  }

  const smtpMissing = actionError instanceof ApiError && actionError.code === 'SMTP_NOT_CONFIGURED';
  const runIdParam = encodeURIComponent(run.id);
  const finalPayEmployee = run.finalPayEmployeeId
    ? run.payslips.find((p) => p.employeeId === run.finalPayEmployeeId)
    : undefined;

  return (
    <>
      <PageHeader
        title={`${runKindLabels[run.kind]}${run.thirteenthMode ? ` (${run.thirteenthMode})` : ''}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RunStatusBadge status={run.status} />
            <span>{formatPeriod(run.periodStart, run.periodEnd)}</span>
            <span aria-hidden="true">·</span>
            <span>Pay date {formatDate(run.payDate)}</span>
            <span aria-hidden="true">·</span>
            <span>Rates {run.ratesVersion}</span>
            {!run.ratesVerified ? <Badge tone="danger">Unverified</Badge> : null}
          </span>
        }
        actions={actions}
      />

      <div className="space-y-6">
        <p>
          <Link to="/payroll" className={linkClass}>
            ← All payroll runs
          </Link>
        </p>

        {!run.ratesVerified ? <RatesVerifyBanner to="/settings/rates" /> : null}

        {actionError !== null ? (
          <Banner tone="danger" title={smtpMissing ? 'Email is not set up' : 'Action failed'}>
            {errorMessage(actionError)}
            {smtpMissing ? (
              <>
                {' '}
                <Link
                  to="/settings"
                  className={`font-semibold underline underline-offset-2 ${focusRing}`}
                >
                  Open Settings
                </Link>
              </>
            ) : null}
          </Banner>
        ) : null}

        {emailResult ? <EmailResultView result={emailResult} run={run} /> : null}

        {run.status === 'draft' && run.lastReopenReason ? (
          <Banner tone="info" title="Reopened">
            {run.lastReopenReason}
          </Banner>
        ) : null}

        {run.kind === 'final_pay' ? (
          <Banner tone="info" title="Final pay">
            {finalPayEmployee ? `${finalPayEmployee.employeeName}: ` : null}
            last salary, prorated 13th month, unused leave conversion, loan payoff and tax
            annualization. Approving marks the employee as separated.
            {run.status === 'draft'
              ? ' Final-pay runs are computed once: delete this draft and create it again to recompute.'
              : null}
          </Banner>
        ) : null}

        {run.status === 'review' && isOwner ? (
          <Banner tone="info">
            Check the figures below, then approve. Approving posts loan payments and, for regular
            runs, locks attendance for the period.
          </Banner>
        ) : null}

        <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Gross pay" value={run.totals.gross} />
          <Stat label="Deductions" value={run.totals.deductions} />
          <Stat label="Net pay" value={run.totals.net} emphasis />
          <Stat label="Employer shares" value={run.totals.employerShares} />
        </section>

        {warningCounts.size > 0 ? (
          <Card title={`Warnings (${run.warningCount})`}>
            <ul className="flex flex-wrap gap-2">
              {[...warningCounts.entries()].map(([code, count]) => (
                <li key={code}>
                  <Badge tone={code === 'negative_net' ? 'danger' : 'warning'}>
                    {warningLabels[code]}: {count}
                  </Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Hover a warning in the table, or open the payslip, for details.
            </p>
          </Card>
        ) : null}

        <section aria-labelledby="slips-heading" className="space-y-3">
          <h2 id="slips-heading" className="text-base font-semibold">
            Employees ({run.employeeCount})
          </h2>
          <DataTable
            caption="Payslips in this run"
            columns={slipColumns}
            rows={run.payslips}
            rowKey={(r) => r.id}
            emptyTitle="No payslips"
            emptyDescription="No active employees were in this period."
            onRowClick={(r) => void navigate(`/payslips/${r.id}`)}
          />
        </section>

        <Card title="Downloads">
          <div className="flex flex-wrap gap-2">
            <a
              href={`/api/payroll-runs/${runIdParam}/payslips.zip`}
              download
              className={buttonClass('secondary', 'sm')}
            >
              All payslips (ZIP)
            </a>
            <a
              href={`/api/reports/payroll-register?runId=${runIdParam}&format=csv`}
              download
              className={buttonClass('secondary', 'sm')}
            >
              Payroll register (CSV)
            </a>
            <a
              href={`/api/reports/payroll-register?runId=${runIdParam}&format=pdf`}
              download
              className={buttonClass('secondary', 'sm')}
            >
              Payroll register (PDF)
            </a>
            {isOwner && posted ? (
              <a
                href={`/api/reports/disbursement?runId=${runIdParam}&format=csv`}
                download
                className={buttonClass('secondary', 'sm')}
              >
                Bank / GCash payout (CSV)
              </a>
            ) : null}
            {isOwner && posted ? (
              <Button
                size="sm"
                loading={busy === 'email'}
                disabled={disabled}
                onClick={() => void emailPayslips()}
              >
                Email payslips
              </Button>
            ) : null}
          </div>
          {!posted ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Payslips are marked DRAFT until the run is approved. The payout file and emailing
              unlock after approval.
            </p>
          ) : null}
        </Card>
      </div>

      {dialog === 'delete' ? (
        <ConfirmModal
          title="Delete draft run?"
          confirmLabel="Delete run"
          variant="danger"
          busy={busy === 'delete'}
          onConfirm={() => void remove()}
          onClose={() => setDialog(null)}
        >
          <p>
            This deletes the {runKindLabels[run.kind].toLowerCase()} draft for{' '}
            {formatPeriod(run.periodStart, run.periodEnd)} and all its payslips. Attendance, loans
            and deductions are not touched. You can create the run again later.
          </p>
        </ConfirmModal>
      ) : null}
      {dialog === 'approve' ? (
        <ConfirmModal
          title="Approve payroll run?"
          confirmLabel="Approve"
          busy={busy === 'approve'}
          onConfirm={() => void approve()}
          onClose={() => setDialog(null)}
        >
          <p>Approving posts this run:</p>
          <ul className="list-disc space-y-1 pl-5">
            {isRegularKind ? (
              <li>Attendance for {formatPeriod(run.periodStart, run.periodEnd)} is locked.</li>
            ) : null}
            <li>Loan amortizations are posted to the loan ledgers.</li>
            <li>One-off deductions are marked as taken.</li>
            {run.kind === 'final_pay' ? <li>The employee is marked as separated.</li> : null}
            <li>The figures count toward YTD, remittance and BIR reports.</li>
          </ul>
          <p>
            Net pay {formatPeso(run.totals.net)} for {run.employeeCount} employee
            {run.employeeCount === 1 ? '' : 's'}. You can reopen it later with a reason.
          </p>
          {run.warningCount > 0 ? (
            <Banner tone="warning">
              This run has {run.warningCount} warning{run.warningCount === 1 ? '' : 's'}.
            </Banner>
          ) : null}
        </ConfirmModal>
      ) : null}
      {dialog === 'reopen' ? (
        <ReopenModal runId={run.id} onDone={applyRun} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
