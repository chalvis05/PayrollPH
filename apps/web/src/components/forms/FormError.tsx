import type { FieldErrors, FieldValues } from 'react-hook-form';
import { Banner } from '../Banner';

interface FormErrorProps<T extends FieldValues> {
  errors: FieldErrors<T>;
}

/**
 * Form-level error (e.g. a server rejection), set with
 * `setError('root.server', { message })` or `setError('root', { message })`.
 */
export function FormError<T extends FieldValues>({ errors }: FormErrorProps<T>) {
  const message = errors.root?.['server']?.message ?? errors.root?.message;
  if (message === undefined || message === '') return null;
  return (
    <Banner tone="danger" title="Could not save">
      {message}
    </Banner>
  );
}
