import { useId } from 'react';
import { useController } from 'react-hook-form';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FieldShell, describedBy, inputClass, fieldErrorMessage } from './FieldShell';
import type { BaseFieldProps } from './FieldShell';

export interface TextAreaFieldProps<
  T extends FieldValues,
  N extends FieldPath<T>,
  TT = T,
> extends BaseFieldProps<T, N, TT> {
  rows?: number | undefined;
  placeholder?: string | undefined;
  /** Store an empty textarea as `null` (for `.nullable()` schema fields). */
  emptyAsNull?: boolean | undefined;
}

export function TextAreaField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  required,
  disabled,
  className,
  rows = 3,
  placeholder,
  emptyAsNull = false,
}: TextAreaFieldProps<T, N, TT>) {
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
      <textarea
        id={id}
        ref={ref}
        name={fieldName}
        rows={rows}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(emptyAsNull && e.target.value === '' ? null : e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClass}
      />
    </FieldShell>
  );
}
