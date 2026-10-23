import { AppError } from '@coachingdesk/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../../test/test-app';

let app: FastifyInstance;

afterEach(async () => {
  await app.close();
});

function setup() {
  const testApp = buildTestApp();
  app = testApp.app;
  // Routes that fail in each way the error handler knows.
  app.get('/test/bug/:id', async () => {
    throw new Error('db exploded for 9812345678');
  });
  app.get('/test/business', async () => {
    throw new AppError('NOTHING_DUE', 'Nothing is due');
  });
  app.get('/test/validation', async () => {
    z.object({ n: z.number() }).parse({ n: 'x' });
  });
  return testApp;
}

describe('error reporting (Step 40)', () => {
  it('an unexpected error (our bug): 500 to the client, reported with request id and route', async () => {
    const { errorReporter } = setup();

    const response = await app.inject({ method: 'GET', url: '/test/bug/123' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.message).toBe('Something went wrong. Please try again.');
    expect(errorReporter.captured).toHaveLength(1);
    expect(errorReporter.captured[0]?.context).toEqual({
      requestId: response.json().requestId,
      route: 'GET /test/bug/:id', // the pattern, not the real URL
      userId: undefined,
      instituteId: undefined,
    });
  });

  it('business and validation errors are expected answers, not bugs: not reported', async () => {
    const { errorReporter } = setup();

    expect((await app.inject({ method: 'GET', url: '/test/business' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/test/validation' })).statusCode).toBe(422);
    expect((await app.inject({ method: 'GET', url: '/nowhere' })).statusCode).toBe(404);

    expect(errorReporter.captured).toHaveLength(0);
  });
});
