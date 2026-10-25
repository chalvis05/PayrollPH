import { zodResolver } from '@hookform/resolvers/zod';
import { RejectChangeRequestSchema } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge, type BadgeTone } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button, buttonClass } from '../components/Button';
import { Card } from '../components/Card';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { FormError, TextAreaField } from '../components/forms';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Spinner } from '../components/Spinner';
import { useIsEncoder, useIsOwner, useMe } from '../lib/auth';
import { formatDateTime } from '../lib/dates';
import { applyServerError } from '../lib/forms';
import { requestStatusLabels } from '../lib/labels';

type Row = ResponseOf<'/api/employee-requests/', 'get'>[number];
type Detail = ResponseOf<'/api/employee-requests/{id}', 'get'>;
type RejectIn = z.input<typeof RejectChangeRequestSchema>;
type RejectOut = z.output<typeof RejectChangeRequestSchema>;

const statusTone: Record<Row['status'], BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const requestsKey = ['employee-requests'] as const;

/** JSON-ish values (allowances, payout, rest days…) shown readably; plain strings as-is. */
function ValueCell({ value }: { value: string | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  const pretty = prettyJson(value);
  if (pretty !== null) {
    return (
      <pre className="max-w-xs overflow-x-auto rounded bg-slate-100 p-2 text-xs whitespace-pre-wrap dark:bg-slate-800">
        {pretty}
      </pre>
    );
  }
  return <span className="break-words">{value}</span>;
}

function prettyJson(value: string): string | null {
  if (!value.startsWith('{') && !value.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(value), null, 1);
  } catch {
    return null;
  }
}

function RejectModal({ request, onDone }: { request: Detail; onDone: () => void }) {
  const qc = useQueryClient();
  const { control, handleSubmit, formState, setError } = useForm<RejectIn, unknown, RejectOut>({
    resolver: zodResolver(RejectChangeRequestSchema),
    defaultValues: { reason: '' },
  });
  return (
    <Modal
      open
      onClose={onDone}
      title="Reject this request?"
      footer={
        <>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="reject-request"
            variant="danger"
            loading={formState.isSubmitting}
          >
            Reject
          </Button>
        </>
      }
    >
      <form
        id="reject-request"
        noValidate
        className="space-y-4"
        onSubmit={(e) =>
          void handleSubmit(async (body) => {
            try {
              await unwrap(
                api.POST('/api/employee-requests/{id}/reject', {
                  params: { path: { id: request.id } },
                  body,
                }),
              );
              await qc.invalidateQueries({ queryKey: requestsKey });
              await qc.invalidateQueries({ queryKey: ['dashboard'] });
              onDone();
            } catch (err) {
              applyServerError(err, setError);
            }
          })(e)
        }
      >
        <FormError errors={formState.errors} />
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Nothing changes for {request.summary.fullName}. The encoder sees your reason.
        </p>
        <TextAreaField control={control} name="reason" label="Reason" required />
      </form>
    </Modal>
  );
}

function RequestDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const isOwner = useIsOwner();
  const me = useMe().data;
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: [...requestsKey, id],
    queryFn: () => unwrap(api.GET('/api/employee-requests/{id}', { params: { path: { id } } })),
  });

  if (detail.isPending) return <Spinner label="Loading request" />;
  if (detail.error) return <Banner tone="danger">{errorMessage(detail.error)}</Banner>;
  const r = detail.data;
  const pending = r.status === 'pending';
  const canWithdraw = pending && (isOwner || r.requestedBy?.id === me?.id);

  const act = async (action: 'approve' | 'cancel') => {
    setBusy(true);
    setActionError(null);
    try {
      if (action === 'approve') {
        await unwrap(api.POST('/api/employee-requests/{id}/approve', { params: { path: { id } } }));
      } else {
        await unwrap(api.POST('/api/employee-requests/{id}/cancel', { params: { path: { id } } }));
      }
      await qc.invalidateQueries({ queryKey: requestsKey });
      await qc.invalidateQueries({ queryKey: ['employees'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirmApprove(false);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`${r.kind === 'create' ? 'New employee' : 'Edit'}: ${r.summary.fullName} (${r.summary.employeeNo})`}
      actions={
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={statusTone[r.status]}>{requestStatusLabels[r.status]}</Badge>
        <span className="text-slate-600 dark:text-slate-400">
          Requested by {r.requestedBy?.name ?? 'a removed user'} on {formatDateTime(r.requestedAt)}
          {r.decidedBy && r.decidedAt
            ? ` · ${r.status === 'cancelled' ? 'withdrawn' : r.status} by ${r.decidedBy.name} on ${formatDateTime(r.decidedAt)}`
            : ''}
        </span>
      </div>
      {r.decisionNote ? (
        <Banner tone="danger" title="Reason" className="mb-4">
          {r.decisionNote}
        </Banner>
      ) : null}
      {r.status === 'approved' && r.resultEmployeeId ? (
        <p className="mb-4 text-sm">
          <Link className="underline" to={`/employees/${r.resultEmployeeId}`}>
            Open the employee record
          </Link>
        </p>
      ) : null}
      {actionError ? (
        <Banner tone="danger" className="mb-4">
          {actionError}
        </Banner>
      ) : null}

      <h3 className="mb-2 text-sm font-semibold">
        {r.kind === 'create' ? 'Proposed record' : 'What changes'}
      </h3>
      {r.changes.length === 0 ? (
        <p className="text-sm text-slate-500">No differences from the current record.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500 uppercase">
              <tr>
                <th className="py-2 pr-3">Field</th>
                {r.kind === 'update' ? <th className="py-2 pr-3">Now</th> : null}
                <th className="py-2">{r.kind === 'update' ? 'Proposed' : 'Value'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {r.changes.map((c) => (
                <tr key={c.field} className="align-top">
                  <td className="py-2 pr-3 font-medium">{c.label}</td>
                  {r.kind === 'update' ? (
                    <td className="py-2 pr-3 text-slate-500">
                      <ValueCell value={c.from} />
                    </td>
                  ) : null}
                  <td className="py-2">
                    <ValueCell value={c.to} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pending ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {isOwner ? (
            <>
              <Button onClick={() => setConfirmApprove(true)}>Approve</Button>
              <Button variant="danger" onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </>
          ) : null}
          {canWithdraw && !isOwner ? (
            <Button variant="secondary" loading={busy} onClick={() => void act('cancel')}>
              Withdraw request
            </Button>
          ) : null}
        </div>
      ) : null}

      {confirmApprove ? (
        <Modal
          open
          onClose={() => setConfirmApprove(false)}
          title="Approve this change?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmApprove(false)}>
                Cancel
              </Button>
              <Button loading={busy} onClick={() => void act('approve')}>
                Approve
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {r.kind === 'create'
              ? `${r.summary.fullName} will be added as an employee.`
              : `${r.summary.fullName}'s record will be updated as shown.`}{' '}
            The audit log records both who asked and who approved.
          </p>
          {actionError ? (
            <Banner tone="danger" className="mt-3">
              {actionError}
            </Banner>
          ) : null}
        </Modal>
      ) : null}
      {rejecting ? <RejectModal request={r} onDone={() => setRejecting(false)} /> : null}
    </Card>
  );
}

export function ApprovalsPage() {
  const isOwner = useIsOwner();
  const isEncoder = useIsEncoder();
  const [filter, setFilter] = useState<'pending' | ''>('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: [...requestsKey, filter],
    queryFn: () =>
      unwrap(
        api.GET('/api/employee-requests/', { params: { query: filter ? { status: filter } : {} } }),
      ),
    enabled: isOwner || isEncoder,
  });

  if (!isOwner && !isEncoder) {
    return (
      <>
        <PageHeader title="Approvals" />
        <Banner tone="info">Approvals are for the owner and encoders.</Banner>
      </>
    );
  }

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'when',
      header: 'Requested',
      cell: (r) => formatDateTime(r.requestedAt),
      hideOnMobile: true,
    },
    {
      id: 'employee',
      header: 'Employee',
      cell: (r) => (
        <div>
          <div className="font-medium">{r.summary.fullName}</div>
          <div className="text-xs text-slate-500">
            {r.kind === 'create' ? 'New employee' : 'Edit'} · {r.summary.employeeNo}
          </div>
        </div>
      ),
    },
    ...(isOwner
      ? [
          {
            id: 'by',
            header: 'By',
            cell: (r: Row) => r.requestedBy?.name ?? '—',
            hideOnMobile: true,
          },
        ]
      : []),
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <Badge tone={statusTone[r.status]}>{requestStatusLabels[r.status]}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          isOwner
            ? 'Employee additions and edits from encoders. Nothing changes until you approve.'
            : 'Your employee additions and edits, and what the owner decided.'
        }
        actions={
          isEncoder ? (
            <Link to="/employees/new" className={buttonClass('primary')}>
              Propose new employee
            </Link>
          ) : undefined
        }
      />
      <div className="mb-4 flex gap-2" role="group" aria-label="Show">
        <Button
          size="sm"
          variant={filter === 'pending' ? 'primary' : 'secondary'}
          onClick={() => setFilter('pending')}
        >
          Waiting
        </Button>
        <Button
          size="sm"
          variant={filter === '' ? 'primary' : 'secondary'}
          onClick={() => setFilter('')}
        >
          All
        </Button>
      </div>
      {selected ? (
        <div className="mb-6">
          <RequestDetailPanel id={selected} onClose={() => setSelected(null)} />
        </div>
      ) : null}
      {list.error ? <Banner tone="danger">{errorMessage(list.error)}</Banner> : null}
      <DataTable
        caption="Employee change requests"
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.isPending}
        emptyTitle={filter === 'pending' ? 'Nothing waiting' : 'No requests yet'}
        emptyDescription={
          isEncoder ? 'Add or edit an employee to send a change for approval.' : undefined
        }
        onRowClick={(r) => setSelected(r.id)}
      />
    </>
  );
}
