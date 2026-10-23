import type { ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { cn } from '../../lib/cn';

/**
 * Props shared by every react-hook-form-bound field.
 * `TTransformed` is the resolver's output type (zod output), inferred from `control`.
 */
export interface BaseFieldProps<T extends FieldValues, N extends FieldPath<T>, TTransformed = T> {
  control: Control<T, unknown, TTransformed>;
  name: N;
  label: string;
  hint?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

export const inputClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 ' +
  'focus:border-emerald-600 focus:outline-2 focus:outline-offset-0 focus:outline-emerald-600/40 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ' +
  'aria-[invalid=true]:border-red-500 ' +
  'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';

/**
 * The message to show for a field: a required field that is still empty says "Required"
 * instead of the schema's format message (e.g. "Invalid UUID" for an unchosen select).
 */
export function fieldErrorMessage(
  message: string | undefined,
  value: unknown,
  required: boolean | undefined,
): string | undefined {
  if (message === undefined) return undefined;
  const empty = value === null || value === undefined || value === '';
  return required === true && empty ? 'Required' : message;
}

export function describedBy(id: string, hint: string | undefined, error: string | undefined) {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/** Label + control + hint + error message, wired with matching ids. */
export function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-800 dark:text-slate-200">
        {label}
        {required === true ? (
          <span className="ml-0.5 text-red-600 dark:text-red-400" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint !== undefined ? (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
