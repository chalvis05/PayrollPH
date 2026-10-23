import type { FieldPath, FieldValues, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from '../api/client';

interface ValidationDetail {
  path?: unknown;
  message?: unknown;
}

/**
 * Show a server error on the form: VALIDATION_ERROR details go to their fields (the API reports
 * JSON-pointer paths like `/allowances/0/amount`), anything else becomes the form-level banner.
 */
export function applyServerError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): void {
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    let placed = false;
    for (const d of err.details as ValidationDetail[]) {
      if (typeof d.path !== 'string' || d.path === '' || typeof d.message !== 'string') continue;
      const name = d.path.replace(/^\//, '').replaceAll('/', '.') as FieldPath<T>;
      setError(name, { type: 'server', message: d.message });
      placed = true;
    }
    if (placed) return;
  }
  setError('root.server', { type: 'server', message: errorMessage(err) });
}
