import type { paths } from './schema';

type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : never;

/** JSON body of the 200/201 response of `METHOD path`, e.g. ResponseOf<'/api/employees/', 'get'>. */
export type ResponseOf<
  P extends keyof paths,
  M extends keyof paths[P] & ('get' | 'post' | 'put' | 'delete'),
> = paths[P][M] extends { responses: infer R }
  ? R extends { 200: infer OK }
    ? JsonOf<OK>
    : R extends { 201: infer Created }
      ? JsonOf<Created>
      : never
  : never;

/** JSON request body of `METHOD path`. */
export type BodyOf<
  P extends keyof paths,
  M extends keyof paths[P] & ('post' | 'put'),
> = paths[P][M] extends { requestBody?: infer B }
  ? NonNullable<B> extends { content: { 'application/json': infer J } }
    ? J
    : never
  : never;
