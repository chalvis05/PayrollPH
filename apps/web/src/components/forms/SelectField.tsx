import { useId } from 'react';
import { useController } from 'react-hook-form';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FieldShell, describedBy, inputClass, fieldErrorMessage } from './FieldShell';
import type { BaseFieldProps } from './FieldShell';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
}

export interface SelectFieldProps<
  T extends FieldValues,
  N extends FieldPath<T>,
  TT = T,
> extends BaseFieldProps<T, N, TT> {
  options: readonly SelectOption[];
  /** Shown as an empty first option; selecting it stores `null`. */
  placeholder?: string | undefined;
}

export function SelectField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  required,
  disabled,
  className,
  options,
  placeholder,
}: SelectFieldProps<T, N, TT>) {
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
      <select
        id={id}
        ref={ref}
        name={fieldName}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        required={required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClass}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
