import { AppError, type ErrorCode } from '@coachingdesk/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

// Record<ErrorCode, number> means EVERY error code must be listed here.
// Add a new code to errors.ts and forget it here: compile error. You can't ship an unmapped error.
const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INSTITUTE_PENDING_DELETION: 409,
  NOTHING_DUE: 409,
  ALREADY_REMINDED_TODAY: 409,
  OWNER_OF_INSTITUTES: 409,
  TERMS_OUTDATED: 409,
  PLAN_LIMIT_REACHED: 402,
  FEATURE_NOT_IN_PLAN: 402,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  RATE_LIMITED: 429,
  DAILY_LIMIT_REACHED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

// Every error response has the same shape (docs/API_DOCS.md → Errors).
// requestId lets you find the matching server log line when a user reports a problem.
function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
) {
  return reply
    .status(HTTP_STATUS[code])
    .send({ error: { code, message, details }, requestId: request.id });
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // 1. Our own business errors: safe to show the message to the user.
    if (error instanceof AppError) {
      const retryAfter = error.details.retryAfterSeconds;
      if (typeof retryAfter === 'number') {
        reply.header('retry-after', String(retryAfter)); // standard HTTP header for 429
      }
      return sendError(request, reply, error.code, error.message, error.details);
    }

    // 2. Zod validation: tell the client WHICH fields are wrong.
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return sendError(request, reply, 'VALIDATION_FAILED', 'Some fields are invalid', { issues });
    }

    // 3. Fastify's own client errors, e.g. a body that isn't valid JSON.
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return sendError(request, reply, 'VALIDATION_FAILED', 'The request could not be read');
    }

    // 4. Anything else is OUR bug. Log the details, but NEVER send them to the client:
    //    error messages can contain SQL, file paths, even secrets.
    request.log.error({ err: error }, 'unhandled error');
    return sendError(request, reply, 'INTERNAL', 'Something went wrong. Please try again.');
  });

  app.setNotFoundHandler((request, reply) =>
    sendError(request, reply, 'NOT_FOUND', 'Route not found'),
  );
}
