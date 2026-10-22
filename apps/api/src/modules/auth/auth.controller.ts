import { RefreshTokenBody, RequestOtpBody, VerifyOtpBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService } from './auth.service';
import type { OtpService } from './otp.service';
import type { SessionService } from './session.service';

export interface AuthControllerDeps {
  otpService: OtpService;
  authService: AuthService;
  sessionService: SessionService;
}

/**
 * HTTP <-> domain translation. No business rules live here.
 * It depends on concrete service CLASSES, not interfaces: there's one of each,
 * and tests use the real ones with fakes inside. "No abstraction until a second implementation".
 */
export class AuthController {
  constructor(private readonly deps: AuthControllerDeps) {}

  /** POST /v1/auth/otp/request -> 204 */
  async requestOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // parse() throws ZodError on bad input; the error handler turns that into a 422.
    const body = RequestOtpBody.parse(request.body);
    await this.deps.otpService.requestOtp(body.phone, { ip: request.ip });
    await reply.status(204).send(); // 204 No Content: success, nothing to return
  }

  /** POST /v1/auth/otp/verify -> 200 { accessToken, refreshToken, user, isNewUser } */
  async verifyOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = VerifyOtpBody.parse(request.body);
    const result = await this.deps.authService.login(
      body.phone,
      body.otp,
      body.device ?? null,
      body.acceptedTerms ?? null,
    );
    await reply.status(200).send({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      user: result.user.toPublicJSON(),
      isNewUser: result.isNewUser,
    });
  }

  /** POST /v1/auth/refresh -> 200 { accessToken, refreshToken } */
  async refresh(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = RefreshTokenBody.parse(request.body);
    const tokens = await this.deps.sessionService.refresh(body.refreshToken);
    await reply.status(200).send(tokens);
  }

  /** POST /v1/auth/logout -> 204, even for unknown tokens (logging out twice is fine) */
  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = RefreshTokenBody.parse(request.body);
    await this.deps.sessionService.logout(body.refreshToken);
    await reply.status(204).send();
  }
}
