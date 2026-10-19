import { AppError } from '@coachingdesk/shared';
import type { FastifyRequest } from 'fastify';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Reads an id from the URL (e.g. :batchId). A value that isn't even a UUID can't exist, so it
 * gets the same 404 as an unknown id, instead of reaching Postgres and failing there with a 500.
 */
export function uuidParam(request: FastifyRequest, name: string, notFoundMessage: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  if (!isUuid(value)) {
    throw new AppError('NOT_FOUND', notFoundMessage);
  }
  return value.toLowerCase();
}
