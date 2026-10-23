import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError, api, errorMessage, postJson, unwrap, upload } from '../api/client';
import type { ResponseOf } from '../api/types';
import { Banner } from '../components/Banner';
import { Button, buttonClass } from '../components/Button';
import { DataTable, type DataTableColumn } from '../components/DataTable';
import { inputClass } from '../components/forms/FieldShell';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { useIsOwner, useLogout } from '../lib/auth';
import { cn } from '../lib/cn';
import { formatDateTime } from '../lib/dates';
import { formatBytes } from '../lib/format';

type Row = ResponseOf<'/api/backups/', 'get'>[number];
type RestoreResult = ResponseOf<'/api/backups/restore', 'post'>;

const backupsKey = ['backups'] as const;
const CONFIRM_WORD = 'RESTORE';

function downloadUrl(name: string): string {
  return `/api/backups/${encodeURIComponent(name)}`;
}

/** Extra guidance for the error codes the backup routes can return. */
function backupErrorMessage(err: unknown): string {
  const base = errorMessage(err);
  if (err instanceof ApiError && err.code === 'PG_TOOLS_MISSING') {
    return `${base} Backups need pg_dump and pg_restore (PostgreSQL 18) on the API server.`;
  }
  if (err instanceof ApiError && err.code === 'BACKUP_BUSY') {
    return 'Another backup or restore is running right now. Wait a minute and try again.';
  }
  return base;
}

function DeleteBackupModal({ backup, onClose }: { backup: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(api.DELETE('/api/backups/{file}', { params: { path: { file: backup.name } } }));
      await qc.invalidateQueries({ queryKey: backupsKey });
      onClose();
    } catch (err) {
      setError(backupErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Delete backup?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void onDelete()}>
            Delete backup
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error ? (
          <Banner tone="danger" title="Could not delete">
            {error}
          </Banner>
        ) : null}
        <p>
          Permanently delete <code className="font-mono break-all">{backup.name}</code> (
          {formatBytes(backup.size)}, {formatDateTime(backup.createdAt)})? This cannot be undone.
        </p>
      </div>
    </Modal>
  );
}

type RestoreSource = 'existing' | 'upload';

function RestoreModal({
  backups,
  initialFile,
  onClose,
}: {
  backups: readonly Row[];
  initialFile: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const logout = useLogout();
  const ids = useId();
  const [source, setSource] = useState<RestoreSource>(
    initialFile !== null || backups.length > 0 ? 'existing' : 'upload',
  );
  const [file, setFile] = useState<string>(initialFile ?? backups[0]?.name ?? '');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typed === CONFIRM_WORD;
  const hasSource = source === 'existing' ? file !== '' : uploadFile !== null;

  const onRestore = async () => {
    if (!confirmed || !hasSource) return;
    setBusy(true);
    setError(null);
    try {
      if (source === 'existing') {
        await postJson<RestoreResult>('/api/backups/restore', {
          file,
          confirm: CONFIRM_WORD,
        });
      } else if (uploadFile) {
        const form = new FormData();
        // Fields before the file, so the server reads `confirm` before streaming the upload.
        form.append('confirm', CONFIRM_WORD);
        form.append('file', uploadFile, uploadFile.name);
        await upload<RestoreResult>('/api/backups/restore', form);
      }
    } catch (err) {
      setError(backupErrorMessage(err));
      setBusy(false);
      return;
    }
    // All data (sessions included) was replaced: end this session, drop every cached query,
    // and sign in again against the restored accounts.
    await logout();
    void navigate('/login', { replace: true });
  };

  const radioClass =
    'flex cursor-pointer items-start gap-2 rounded-md border border-slate-300 p-3 text-sm has-[:checked]:border-red-600 has-[:checked]:bg-red-50 dark:border-slate-700 dark:has-[:checked]:border-red-500 dark:has-[:checked]:bg-red-950/40';

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title="Restore from backup"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!confirmed || !hasSource}
            onClick={() => void onRestore()}
          >
            Replace all data
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <Banner tone="danger" title="This replaces ALL data">
          Every employee, payroll run, payslip, setting and user account in the payrollph database
          is replaced with the contents of the backup. Anything entered after that backup was made
          is lost. Everyone is signed out and must sign in with the accounts from the backup.
          Consider clicking “Back up now” first.
        </Banner>
        {error ? (
          <Banner tone="danger" title="Restore failed">
            {error}
          </Banner>
        ) : null}

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="mb-1 font-medium">Restore from</legend>
          <label className={radioClass}>
            <input
              type="radio"
              name={`${ids}-source`}
              value="existing"
              checked={source === 'existing'}
              onChange={() => setSource('existing')}
              disabled={backups.length === 0}
              className="mt-0.5 accent-red-700"
            />
            <span>
              A backup on the server
              {backups.length === 0 ? (
                <span className="block text-xs text-slate-500">No backups yet.</span>
              ) : null}
            </span>
          </label>
          <label className={radioClass}>
            <input
              type="radio"
              name={`${ids}-source`}
              value="upload"
              checked={source === 'upload'}
              onChange={() => setSource('upload')}
              className="mt-0.5 accent-red-700"
            />
            <span>A .dump file from this device</span>
          </label>
        </fieldset>

        {source === 'existing' ? (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-file`} className="font-medium">
              Backup
            </label>
            <select
              id={`${ids}-file`}
              value={file}
              onChange={(e) => setFile(e.target.value)}
              disabled={busy}
              className={inputClass}
            >
              {backups.map((b) => (
                <option key={b.name} value={b.name}>
                  {formatDateTime(b.createdAt)} — {b.name} ({formatBytes(b.size)})
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-upload`} className="font-medium">
              Backup file
            </label>
            <input
              id={`${ids}-upload`}
              type="file"
              accept=".dump,application/octet-stream"
              disabled={busy}
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              aria-describedby={`${ids}-upload-hint`}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-sm file:font-medium dark:file:bg-slate-700 dark:file:text-slate-100"
            />
            <p id={`${ids}-upload-hint`} className="text-xs text-slate-500 dark:text-slate-400">
              A PostgreSQL custom-format dump downloaded from this page.
              {uploadFile ? ` Selected: ${uploadFile.name} (${formatBytes(uploadFile.size)}).` : ''}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-confirm`} className="font-medium">
            Type <span className="font-mono font-bold">{CONFIRM_WORD}</span> to confirm
          </label>
          <input
            id={`${ids}-confirm`}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            className={cn(inputClass, 'font-mono')}
          />
        </div>
        {busy ? (
          <p role="status" className="text-slate-600 dark:text-slate-400">
            Restoring… this can take a few minutes for a large database. Keep this page open.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

type Dialog = { kind: 'delete'; backup: Row } | { kind: 'restore'; file: string | null } | null;

export function BackupsPage() {
  const isOwner = useIsOwner();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [created, setCreated] = useState<Row | null>(null);

  const backups = useQuery({
    queryKey: backupsKey,
    queryFn: () => unwrap(api.GET('/api/backups/')),
    enabled: isOwner,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => unwrap(api.GET('/api/settings')),
    enabled: isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Backups" />
        <Banner tone="info" title="Owner only">
          Backups contain all payroll data, so only the owner can see, download or restore them.
        </Banner>
      </>
    );
  }

  const onBackupNow = async () => {
    setBackingUp(true);
    setActionError(null);
    setCreated(null);
    try {
      const backup = await unwrap(api.POST('/api/backups/'));
      setCreated(backup);
      await qc.invalidateQueries({ queryKey: backupsKey });
    } catch (err) {
      setActionError(backupErrorMessage(err));
    } finally {
      setBackingUp(false);
    }
  };

  const retention = settings.data?.backupRetentionDays;

  const columns: DataTableColumn<Row>[] = [
    {
      id: 'created',
      header: 'Created',
      cell: (r) => <span className="font-medium">{formatDateTime(r.createdAt)}</span>,
    },
    {
      id: 'name',
      header: 'File',
      cell: (r) => <code className="font-mono text-xs break-all">{r.name}</code>,
      hideOnMobile: true,
    },
    { id: 'size', header: 'Size', align: 'right', cell: (r) => formatBytes(r.size) },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (r) => (
        <div className="flex flex-wrap justify-end gap-1">
          <a
            href={downloadUrl(r.name)}
            download={r.name}
            className={buttonClass('ghost', 'sm')}
            aria-label={`Download ${r.name}`}
          >
            Download
          </a>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: 'restore', file: r.name })}
            aria-label={`Restore ${r.name}`}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDialog({ kind: 'delete', backup: r })}
            aria-label={`Delete ${r.name}`}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Backups"
        description={
          <>
            A backup runs every night at 02:00 (Manila time).{' '}
            {retention !== undefined
              ? `Backups older than ${retention} day${retention === 1 ? '' : 's'} are deleted automatically`
              : 'Old backups are deleted after the retention period'}{' '}
            (change this in{' '}
            <Link to="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            ). Download copies to keep them somewhere safe.
          </>
        }
        actions={
          <>
            <Button variant="danger" onClick={() => setDialog({ kind: 'restore', file: null })}>
              Restore…
            </Button>
            <Button loading={backingUp} onClick={() => void onBackupNow()}>
              Back up now
            </Button>
          </>
        }
      />
      <div className="mb-4 space-y-3">
        {actionError ? (
          <Banner tone="danger" title="Backup failed">
            {actionError}
          </Banner>
        ) : null}
        {created ? (
          <Banner tone="info">
            Backup created: <code className="font-mono break-all">{created.name}</code> (
            {formatBytes(created.size)}).
          </Banner>
        ) : null}
        {backups.error ? <Banner tone="danger">{backupErrorMessage(backups.error)}</Banner> : null}
      </div>
      <DataTable
        caption="Database backups"
        columns={columns}
        rows={backups.data ?? []}
        rowKey={(r) => r.name}
        loading={backups.isPending}
        emptyTitle="No backups yet"
        emptyDescription="Click “Back up now”, or wait for tonight's automatic backup."
      />
      {dialog?.kind === 'delete' ? (
        <DeleteBackupModal backup={dialog.backup} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'restore' ? (
        <RestoreModal
          backups={backups.data ?? []}
          initialFile={dialog.file}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
