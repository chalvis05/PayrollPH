import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';

/** An API error with the server's stable code (e.g. EMPLOYEE_CAP_EXCEEDED) and message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: unknown };
}

export function toApiError(status: number, body: unknown): ApiError {
  const err = (body as ErrorBody | null)?.error;
  const code = typeof err?.code === 'string' ? err.code : `HTTP_${status}`;
  const message =
    typeof err?.message === 'string' ? err.message : `Request failed with status ${status}.`;
  return new ApiError(status, code, message, err?.details);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
  const body = (await res.json()) as { token: string };
  csrfToken = body.token;
  return csrfToken;
}

/** Adds the CSRF header to mutating requests; on a stale token, refreshes it and retries once. */
const csrfMiddleware: Middleware = {
  async onRequest({ request }) {
    if (!MUTATING.has(request.method)) return undefined;
    const token = csrfToken ?? (await fetchCsrfToken());
    request.headers.set('x-csrf-token', token);
    return request;
  },
  async onResponse({ request, response }) {
    if (!MUTATING.has(request.method) || response.status !== 403) return undefined;
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as ErrorBody | null;
    if (body?.error?.code !== 'CSRF_INVALID') return undefined;
    const retry = request.clone();
    retry.headers.set('x-csrf-token', await fetchCsrfToken());
    return fetch(retry);
  },
};

export const api = createClient<paths>({ baseUrl: '', credentials: 'same-origin' });
api.use(csrfMiddleware);

/** After login/logout the CSRF secret cookie may change; forget the cached token. */
export function resetCsrf(): void {
  csrfToken = null;
}

/**
 * Unwrap an openapi-fetch result: return data or throw ApiError.
 * Usage: `const emps = await unwrap(api.GET('/api/employees/'))`.
 */
export async function unwrap<T>(
  promise: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await promise;
  if (error !== undefined || !response.ok) throw toApiError(response.status, error);
  return data as T;
}

/** Send a multipart upload (openapi-fetch does not model multipart bodies from our schema). */
export async function upload<T>(url: string, form: FormData): Promise<T> {
  const token = csrfToken ?? (await fetchCsrfToken());
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { 'x-csrf-token': token },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, body);
  return body as T;
}

/**
 * POST a JSON body with the CSRF header to a route whose OpenAPI entry declares no JSON body
 * (e.g. /api/backups/restore, which also accepts multipart), so the typed client can't send it.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const token = csrfToken ?? (await fetchCsrfToken());
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-csrf-token': token },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw toApiError(res.status, json);
  return json as T;
}

/** Friendly message for any thrown value (ApiError, network failure, etc.). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection.';
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
