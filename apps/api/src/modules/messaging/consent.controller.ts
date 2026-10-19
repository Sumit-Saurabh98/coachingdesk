import {
  AppError,
  GuardianConsentBody,
  InvalidPhoneNumberError,
  PhoneNumber,
} from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { currentTenant } from '../../http/tenancy-guard';
import type { ConsentService } from './consent.service';

/** The phone comes from the URL ("+919876543210" URL-encoded, or "9876543210"). Bad -> 422. */
function phoneParam(request: FastifyRequest): PhoneNumber {
  const { phone } = request.params as { phone?: string };
  try {
    return PhoneNumber.parse(phone ?? '');
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      throw new AppError('VALIDATION_FAILED', error.message, { field: 'phone' });
    }
    throw error;
  }
}

/** /v1/institutes/:instituteId/guardians/:phone/opt-in|opt-out (owner, staff) -> 204 */
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  async optIn(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { source } = GuardianConsentBody.parse(request.body);
    await this.consent.optIn(currentTenant(request).instituteId, phoneParam(request), source);
    await reply.status(204).send();
  }

  async optOut(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { source } = GuardianConsentBody.parse(request.body);
    await this.consent.optOut(currentTenant(request).instituteId, phoneParam(request), source);
    await reply.status(204).send();
  }
}
