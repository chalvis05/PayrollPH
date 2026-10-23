import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../lib/http';
import type { SessionUser } from '../lib/session';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Throws 401 unless a user is signed in. Returns the user for convenience. */
export function requireUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw unauthorized('UNAUTHENTICATED', 'Please sign in.');
  return request.user;
}

/** Throws 401/403 unless the signed-in user is the owner. */
export function requireOwner(request: FastifyRequest): SessionUser {
  const user = requireUser(request);
  if (user.role !== 'owner') throw forbidden('Only the owner can do this.');
  return user;
}

/** onRequest hook for protected scopes: any signed-in user may read; only the owner may write.
 * Runs before body parsing/validation so unauthorised callers never see validation details. */
export async function readAnyWriteOwner(request: FastifyRequest, _reply: FastifyReply) {
  if (READ_METHODS.has(request.method)) requireUser(request);
  else requireOwner(request);
}

/** onRequest hook for owner-only routes (including reads of sensitive data). */
export async function ownerOnly(request: FastifyRequest, _reply: FastifyReply) {
  requireOwner(request);
}
