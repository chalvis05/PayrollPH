import { useId } from 'react';
import { useController } from 'react-hook-form';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { FieldShell, describedBy, inputClass, fieldErrorMessage } from './FieldShell';
import type { BaseFieldProps } from './FieldShell';

export interface NumberFieldProps<
  T extends FieldValues,
  N extends FieldPath<T>,
  TT = T,
> extends BaseFieldProps<T, N, TT> {
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
}

/**
 * Plain numeric field (counts, hours, days). Stores a JS number, or `null` when empty.
 * Do NOT use for money: use MoneyField, which keeps a 2-dp string.
 */
export function NumberField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  required,
  disabled,
  className,
  min,
  max,
  step = 1,
}: NumberFieldProps<T, N, TT>) {
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
        type="number"
        inputMode={step % 1 === 0 ? 'numeric' : 'decimal'}
        value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.valueAsNumber)}
        onBlur={onBlur}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        required={required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={inputClass}
      />
    </FieldShell>
  );
}
