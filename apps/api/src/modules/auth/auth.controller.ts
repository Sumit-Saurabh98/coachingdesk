import { RequestOtpBody, VerifyOtpBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OtpService } from './otp.service';

/**
 * HTTP <-> domain translation. No business rules live here.
 * It depends on the OtpService CLASS, not an interface: there's only one OtpService,
 * and tests use the real one with fakes inside. "No abstraction until a second implementation".
 */
export class AuthController {
  constructor(private readonly otpService: OtpService) {}

  async requestOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // parse() throws ZodError on bad input; the error handler turns that into a 422.
    const body = RequestOtpBody.parse(request.body);
    await this.otpService.requestOtp(body.phone, { ip: request.ip });
    await reply.status(204).send(); // 204 No Content: success, nothing to return
  }

  async verifyOtp(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = VerifyOtpBody.parse(request.body);
    await this.otpService.verifyOtp(body.phone, body.otp);
    // TEMPORARY: Step 8 replaces this with { accessToken, refreshToken, user }.
    await reply.status(200).send({ verified: true });
  }
}
