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

/** /v1/institutes/:instituteId/guardians/:phone/consent | opt-in | opt-out (owner, staff) */
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /** GET .../consent -> 200 { status: unknown|opted_in|opted_out, stoppedEverywhere } */
  async status(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await reply
      .status(200)
      .send(await this.consent.statusOf(currentTenant(request).instituteId, phoneParam(request)));
  }

  /** POST .../opt-in -> 204 */
  async optIn(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { source } = GuardianConsentBody.parse(request.body);
    await this.consent.optIn(currentTenant(request).instituteId, phoneParam(request), source);
    await reply.status(204).send();
  }

  /** POST .../opt-out -> 204 */
  async optOut(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const { source } = GuardianConsentBody.parse(request.body);
    await this.consent.optOut(currentTenant(request).instituteId, phoneParam(request), source);
    await reply.status(204).send();
  }
}
