import { maskPhones } from '@coachingdesk/shared';
import type { FastifyRequest } from 'fastify';

// maskPhones moved to packages/shared (Step 40): error reports (packages/providers) need it too.
export { maskPhones };

/** Fastify's request log serializer, with the URL masked. */
export function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: maskPhones(request.url),
    host: request.host,
    remoteAddress: request.ip,
  };
}
