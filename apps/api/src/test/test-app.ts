import { FakeSmsProvider } from '@coachingdesk/providers';
import { FixedClock, SequentialIdGenerator } from '@coachingdesk/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { InMemoryRateLimiter } from '../lib/rate-limiter';
import { JwtAccessTokens } from '../modules/auth/access-tokens';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthService } from '../modules/auth/auth.service';
import { FixedOtpCodeGenerator } from '../modules/auth/otp-code-generator';
import { OtpHasher } from '../modules/auth/otp-hasher';
import { InMemoryOtpStore } from '../modules/auth/otp-store';
import { OtpService } from '../modules/auth/otp.service';
import { InMemoryRefreshTokenRepository } from '../modules/auth/refresh-token.repository';
import { SessionService } from '../modules/auth/session.service';
import { InMemoryBatchRepository } from '../modules/batches/batch.repository';
import { BatchService } from '../modules/batches/batch.service';
import { BatchesController } from '../modules/batches/batches.controller';
import { InMemoryEnrollmentRepository } from '../modules/enrollments/enrollment.repository';
import { EnrollmentService } from '../modules/enrollments/enrollment.service';
import { EnrollmentsController } from '../modules/enrollments/enrollments.controller';
import { EntitlementsService } from '../modules/entitlements/entitlements.service';
import { InMemoryInstituteRepository } from '../modules/institutes/institute.repository';
import { InstituteService } from '../modules/institutes/institute.service';
import { InstitutesController } from '../modules/institutes/institutes.controller';
import { InMemoryStudentRepository } from '../modules/students/student.repository';
import { StudentService } from '../modules/students/student.service';
import { StudentsController } from '../modules/students/students.controller';
import { InMemorySubscriptionRepository } from '../modules/subscriptions/subscription.repository';
import { SubscriptionService } from '../modules/subscriptions/subscription.service';
import { MeController } from '../modules/users/me.controller';
import { InMemoryUserRepository } from '../modules/users/user.repository';
import { UserService } from '../modules/users/user.service';

/** Every OTP in test apps is this code, so tests can log in without reading an SMS. */
export const TEST_OTP = '482913';

/**
 * The TEST composition root: the same wiring as container.ts, but with in-memory fakes,
 * a FixedClock and a fixed OTP. Every HTTP test builds its app here, so the wiring
 * lives in one place instead of being copied into each test file (DRY).
 */
export function buildTestApp() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const ids = new SequentialIdGenerator();
  const sms = new FakeSmsProvider();

  const otpService = new OtpService({
    store: new InMemoryOtpStore(),
    rateLimiter: new InMemoryRateLimiter(clock),
    sms,
    codeGenerator: new FixedOtpCodeGenerator(TEST_OTP),
    hasher: new OtpHasher('test-secret-that-is-at-least-32-chars-long'),
    clock,
  });
  const accessTokens = new JwtAccessTokens('jwt-test-secret-that-is-at-least-32-chars', clock);
  const sessionService = new SessionService({
    refreshTokens: new InMemoryRefreshTokenRepository(),
    accessTokens,
    ids,
    clock,
  });
  const userService = new UserService(new InMemoryUserRepository(), ids);
  const subscriptionRepository = new InMemorySubscriptionRepository();
  // Shared like one database: creating an institute writes its trial where subscriptions reads it.
  const instituteRepository = new InMemoryInstituteRepository(subscriptionRepository);
  const instituteService = new InstituteService({
    institutes: instituteRepository,
    users: userService,
    ids,
    clock,
  });
  const batchService = new BatchService({ batches: new InMemoryBatchRepository(), ids, clock });
  const studentService = new StudentService({
    students: new InMemoryStudentRepository(),
    entitlements: new EntitlementsService(new SubscriptionService(subscriptionRepository, clock)),
    institutes: instituteService,
    ids,
    clock,
  });
  const enrollmentService = new EnrollmentService({
    enrollments: new InMemoryEnrollmentRepository(),
    students: studentService,
    batches: batchService,
    institutes: instituteService,
    ids,
    clock,
  });
  const authService = new AuthService({
    otp: otpService,
    users: userService,
    sessions: sessionService,
  });

  const app = buildApp({
    authController: new AuthController({ otpService, authService, sessionService }),
    meController: new MeController(userService, instituteService),
    institutesController: new InstitutesController(instituteService),
    batchesController: new BatchesController(batchService, enrollmentService),
    studentsController: new StudentsController(studentService, enrollmentService),
    enrollmentsController: new EnrollmentsController(enrollmentService),
    memberships: instituteService,
    accessTokens,
    isReady: async () => true,
  });

  return { app, clock, sms, accessTokens, instituteRepository, subscriptionRepository };
}

/** Logs in through the real HTTP endpoints and returns the response body (tokens + user). */
export async function loginOverHttp(
  app: FastifyInstance,
  phone = '9876543210',
): Promise<{ accessToken: string; refreshToken: string; user: { id: string } }> {
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, otp: TEST_OTP },
  });
  return response.json();
}
