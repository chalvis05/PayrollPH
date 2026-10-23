import { useId } from 'react';
import { useController } from 'react-hook-form';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { cn } from '../../lib/cn';
import { describedBy } from './FieldShell';
import type { BaseFieldProps } from './FieldShell';

export function CheckboxField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  disabled,
  className,
}: BaseFieldProps<T, N, TT>) {
  const id = useId();
  const {
    field: { ref, name: fieldName, value: rawValue, onChange, onBlur },
    fieldState,
  } = useController<T, N, TT>({ control, name });
  const error = fieldState.error?.message;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-start gap-2">
        <input
          id={id}
          ref={ref}
          name={fieldName}
          type="checkbox"
          checked={rawValue === true}
          onChange={(e) => onChange(e.target.checked)}
          onBlur={onBlur}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(id, hint, error)}
          className="mt-0.5 size-4 rounded border-slate-300 accent-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-slate-600"
        />
        <label htmlFor={id} className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {label}
        </label>
      </div>
      {hint !== undefined ? (
        <p id={`${id}-hint`} className="ml-6 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={`${id}-error`} className="ml-6 text-xs font-medium text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
