import { z } from 'zod';

/** An error with an HTTP status and a stable machine-readable code for the web client. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code: string, message: string) => new HttpError(401, code, message);
export const forbidden = (message = 'You do not have permission to do this.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, message: string, details?: unknown) =>
  new HttpError(409, code, message, details);

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });
export const IdParamsSchema = z.object({ id: z.uuid() });

/** Standard error responses to attach to route schemas for OpenAPI. */
export const errorResponses = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
} as const;
