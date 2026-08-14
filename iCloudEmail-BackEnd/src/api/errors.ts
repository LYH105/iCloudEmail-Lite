import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Unauthorized') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

/**
 * Parse `data` with a zod schema, throwing a 400 HttpError on failure.
 * Constrained to `ZodTypeAny` (not `ZodType<T>`) and returns `z.infer<S>`:
 * inferring T from `z.ZodType<T>` directly picks it up from both the
 * covariant Output *and* Input generic slots, which for schemas with
 * `.default()` silently widens fields back to optional.
 */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Validation failed', result.error.flatten());
  }
  return result.data;
}

/** Central error handler mapping thrown errors to JSON responses. */
export function errorHandler(err: unknown, _req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof HttpError) {
    reply.code(err.statusCode).send({ error: err.message, details: err.details });
    return;
  }
  // iCloud/HME/IMAP errors expose a numeric `status` we surface as-is.
  const status = (err as { status?: number; statusCode?: number }).status;
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  if (typeof status === 'number' && status >= 400 && status < 600) {
    reply.code(status).send({ error: message });
    return;
  }
  reply.code(500).send({ error: message });
}
