import { zodResolver } from '@hookform/resolvers/zod';
import { CreateUserSchema } from '@payrollph/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import type { z } from 'zod';
import { api, errorMessage, unwrap } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Badge } from '../components/Badge';
import { Banner } from '../components/Banner';
import { Button, buttonClass } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { FormError, SelectField, TextField } from '../components/forms';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner, useMe } from '../lib/auth';
import { applyServerError } from '../lib/forms';
import { roleLabels } from '../lib/labels';

type Row = ResponseOf<'/api/users/', 'get'>[number];
type FormIn = z.input<typeof CreateUserSchema>;
type FormOut = z.output<typeof CreateUserSchema>;

const usersKey = ['users'] as const;

const createdFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function formatCreated(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : createdFormatter.format(ms);
}

function AddUserModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { control, handleSubmit, formState, setError } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(CreateUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'viewer' },
  });
  const formId = 'add-user';

  const onSubmit = async (body: FormOut) => {
    try {
      await unwrap(api.POST('/api/users/', { body }));
      await qc.invalidateQueries({ queryKey: usersKey });
      onClose();
    } catch (err) {
      applyServerError(err, setError);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add user"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting}>
            Add user
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
          Both roles see employees, payroll and reports with government IDs and account numbers
          masked. A viewer cannot change anything. An encoder can add and edit employees, but each
          change waits in Approvals until you approve it. Share the password privately; they can
          change it under My account.
        </p>
        <FormError errors={formState.errors} />
        <SelectField
          control={control}
          name="role"
          label="Role"
          options={[
            { value: 'viewer', label: roleLabels.viewer },
            { value: 'encoder', label: roleLabels.encoder },
          ]}
          required
        />
        <TextField control={control} name="name" label="Name" autoComplete="off" required />
        <TextField
          control={control}
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          required
        />
        <TextField
          control={control}
          name="password"
          label="Initial password"
          type="password"
          autoComplete="new-password"
          hint="At least 12 characters."
          required
        />
      </form>
    </Modal>
  );
}

function RemoveUserModal({ user, onClose }: { user: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.DELETE('/api/users/{id}', { params: { path: { id: user.id } } }));
      await qc.invalidateQueries({ queryKey: usersKey });
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
      title="Remove user?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void onRemove()}>
            Remove user
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error ? (
          <Banner tone="danger" title="Could not remove">
            {error}
          </Banner>
        ) : null}
        <p>
          Remove <span className="font-semibold">{user.name}</span> ({user.email})? They are signed
          out everywhere and can no longer sign in. Their past actions stay in the audit log.
        </p>
      </div>
    </Modal>
  );
}

type Dialog = { kind: 'add' } | { kind: 'remove'; user: Row } | null;

export function UsersPage() {
  const isOwner = useIsOwner();
  const me = useMe().data;
  const [dialog, setDialog] = useState<Dialog>(null);
  const users = useQuery({
    queryKey: usersKey,
    queryFn: () => unwrap(api.GET('/api/users/')),
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Users" />
        <Banner tone="info" title="Owner only">
          Only the owner can manage user accounts. To change your own password or 2FA, go to{' '}
          <Link to="/account" className="font-semibold underline underline-offset-2">
            My account
          </Link>
          .
        </Banner>
      </>
    );
  }

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (r) => (
        <div>
          <div className="font-medium">
            {r.name}
            {r.id === me?.id ? <span className="ml-1 text-slate-500">(you)</span> : null}
          </div>
          <div className="text-xs break-all text-slate-500">{r.email}</div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (r) =>
        r.role === 'owner' ? (
          <Badge tone="info">Owner</Badge>
        ) : (
          <Badge tone={r.role === 'encoder' ? 'warning' : 'neutral'}>{roleLabels[r.role]}</Badge>
        ),
    },
    {
      id: '2fa',
      header: '2FA',
      cell: (r) =>
        r.totpEnabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>,
    },
    { id: 'created', header: 'Added', cell: (r) => formatCreated(r.createdAt), hideOnMobile: true },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (r) =>
        r.role === 'owner' ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: 'remove', user: r })}
            aria-label={`Remove ${r.name}`}
          >
            Remove
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="The owner can change everything; viewers have read-only access."
        actions={
          <>
            <Link to="/account" className={buttonClass('secondary')}>
              My password and 2FA
            </Link>
            <Button onClick={() => setDialog({ kind: 'add' })}>Add user</Button>
          </>
        }
      />
      {users.error ? (
        <Banner tone="danger" className="mb-4">
          {errorMessage(users.error)}
        </Banner>
      ) : null}
      <DataTable
        caption="User accounts"
        columns={columns}
        rows={users.data ?? []}
        rowKey={(r) => r.id}
        loading={users.isPending}
        emptyTitle="No users"
      />
      {dialog?.kind === 'add' ? <AddUserModal onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'remove' ? (
        <RemoveUserModal user={dialog.user} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
