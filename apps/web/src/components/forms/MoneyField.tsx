import { useId } from 'react';
import { useController } from 'react-hook-form';
import type { FieldPath, FieldValues } from 'react-hook-form';
import { cn } from '../../lib/cn';
import { FieldShell, describedBy, inputClass, fieldErrorMessage } from './FieldShell';
import type { BaseFieldProps } from './FieldShell';

export interface MoneyFieldProps<
  T extends FieldValues,
  N extends FieldPath<T>,
  TT = T,
> extends BaseFieldProps<T, N, TT> {
  placeholder?: string | undefined;
}

/** Keep digits and one dot, at most 2 decimals. Pure string work: no float maths on money. */
export function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const whole = cleaned.slice(0, dot);
  const frac = cleaned
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, 2);
  return `${whole}.${frac}`;
}

/** Normalise to exactly 2 decimals on blur, e.g. "12" -> "12.00", ".5" -> "0.50". */
export function padMoney(value: string): string {
  if (value === '') return value;
  const [wholeRaw = '', fracRaw = ''] = value.split('.');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '') || '0';
  return `${whole}.${fracRaw.padEnd(2, '0').slice(0, 2)}`;
}

/** Peso amount stored as a 2-dp string (matches `MoneySchema` and NUMERIC(14,2)). */
export function MoneyField<T extends FieldValues, N extends FieldPath<T>, TT = T>({
  control,
  name,
  label,
  hint,
  required,
  disabled,
  className,
  placeholder = '0.00',
}: MoneyFieldProps<T, N, TT>) {
  const id = useId();
  const {
    field: { ref, name: fieldName, value: rawValue, onChange, onBlur },
    fieldState,
  } = useController<T, N, TT>({ control, name });
  const error = fieldErrorMessage(fieldState.error?.message, rawValue, required);
  const value: unknown = rawValue;
  const text = typeof value === 'string' ? value : '';

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500"
        >
          ₱
        </span>
        <input
          id={id}
          ref={ref}
          name={fieldName}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => onChange(sanitizeMoneyInput(e.target.value))}
          onBlur={() => {
            const padded = padMoney(text);
            if (padded !== text) onChange(padded);
            onBlur();
          }}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cn(inputClass, 'pl-7 text-right tabular-nums')}
        />
      </div>
    </FieldShell>
  );
}
