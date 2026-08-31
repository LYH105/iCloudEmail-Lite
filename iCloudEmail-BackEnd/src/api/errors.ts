import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
    readonly code = statusCode === 400 ? 'BAD_REQUEST' : `HTTP_${statusCode}`,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details, 'BAD_REQUEST');
export const unauthorized = (msg = '未授权') => new HttpError(401, msg, undefined, 'UNAUTHORIZED');
export const forbidden = (msg = '无权执行此操作') => new HttpError(403, msg, undefined, 'FORBIDDEN');
export const notFound = (msg = '资源不存在') => new HttpError(404, msg, undefined, 'NOT_FOUND');

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
    throw new HttpError(400, '请求参数校验失败', result.error.flatten(), 'VALIDATION_ERROR');
  }
  return result.data;
}

interface StatusError {
  status?: number;
  statusCode?: number;
  code?: string;
  message?: string;
}

function validStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value < 600 ? value : null;
}

function safeFrameworkMessage(status: number): string {
  if (status === 400) return '请求格式无效';
  if (status === 401) return '未授权';
  if (status === 403) return '无权执行此操作';
  if (status === 404) return '资源不存在';
  if (status === 413) return '请求内容过大';
  if (status === 502 || status === 503 || status === 504) {
    return '上游服务暂时不可用，请稍后重试';
  }
  if (status >= 500) return '服务器内部错误';
  return '请求处理失败';
}

function domainCode(status: number): string {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UPSTREAM_AUTH_ERROR';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  return 'UPSTREAM_ERROR';
}

function sendError(
  reply: FastifyReply,
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  reply.code(status).send({
    error: message,
    code,
    requestId,
    ...(details === undefined ? {} : { details }),
  });
}

/** Central error handler mapping thrown errors to stable, non-sensitive JSON responses. */
export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof HttpError) {
    sendError(reply, req.id, err.statusCode, err.code, err.message, err.details);
    return;
  }

  const statusError = err as StatusError;
  // Domain/upstream errors deliberately expose `status`; their 4xx messages are
  // user-facing. Fastify/parser errors expose `statusCode`; never echo their raw
  // messages because they can contain parser internals or local paths.
  const domainStatus = validStatus(statusError.status);
  if (domainStatus) {
    const safeMessage =
      domainStatus < 500 && err instanceof Error ? err.message : safeFrameworkMessage(domainStatus);
    sendError(reply, req.id, domainStatus, domainCode(domainStatus), safeMessage);
    return;
  }

  const frameworkStatus = validStatus(statusError.statusCode);
  if (frameworkStatus) {
    sendError(
      reply,
      req.id,
      frameworkStatus,
      frameworkStatus === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST',
      safeFrameworkMessage(frameworkStatus),
    );
    return;
  }

  req.log.error({ err }, 'Unhandled request error');
  sendError(reply, req.id, 500, 'INTERNAL_ERROR', safeFrameworkMessage(500));
}
