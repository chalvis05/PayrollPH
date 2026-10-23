import { useId } from 'react';
import { useController } from 'react-hook-form';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FieldShell, describedBy, inputClass, fieldErrorMessage } from './FieldShell';
import type { BaseFieldProps } from './FieldShell';

export interface DateFieldProps<
  T extends FieldValues,
  N extends FieldPath<T>,
  TT = T,
> extends BaseFieldProps<T, N, TT> {
  /** YYYY-MM-DD */
  min?: string | undefined;
  /** YYYY-MM-DD */
  max?: string | undefined;
  /** Store an empty date as `null` (for `DateSchema.nullable()` fields). */
  emptyAsNull?: boolean | undefined;
}

/** Calendar date stored as a `YYYY-MM-DD` string (native date input already uses this format). */
export function DateField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  required,
  disabled,
  className,
  min,
  max,
  emptyAsNull = false,
}: DateFieldProps<T, N, TT>) {
  const id = useId();
  const {
    field: { ref, name: fieldName, value: rawValue, onChange, onBlur },
    fieldState,
  } = useController<T, N, TT>({ control, name });
  const error = fieldErrorMessage(fieldState.error?.message, rawValue, required);
  const value: unknown = rawValue;

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <input
        id={id}
        ref={ref}
        name={fieldName}
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(emptyAsNull && e.target.value === '' ? null : e.target.value)}
        onBlur={onBlur}
        min={min}
        max={max}
        disabled={disabled}
        required={required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClass}
      />
    </FieldShell>
  );
}
