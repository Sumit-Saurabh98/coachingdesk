import { AddMemberBody } from '@coachingdesk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { uuidParam } from '../../http/route-params';
import { currentTenant } from '../../http/tenancy-guard';
import type { InstituteService, MemberView } from './institute.service';

const memberJSON = (member: MemberView) => ({
  userId: member.userId,
  name: member.name,
  phone: member.phone.toE164(),
  role: member.role,
});

/** /v1/institutes/:instituteId/members: the team. Owner only (API_DOCS roles table). */
export class MembersController {
  constructor(private readonly institutes: InstituteService) {}

  /** GET -> 200 { members } */
  async list(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const members = await this.institutes.listMembers(currentTenant(request).instituteId);
    await reply.status(200).send({ members: members.map(memberJSON) });
  }

  /** POST { phone, name, role } -> 201 { member } */
  async add(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const body = AddMemberBody.parse(request.body);
    const member = await this.institutes.addMember(currentTenant(request).instituteId, body);
    await reply.status(201).send({ member: memberJSON(member) });
  }

  /** DELETE /:userId -> 204 */
  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await this.institutes.removeMember(
      currentTenant(request).instituteId,
      uuidParam(request, 'userId', 'Member not found'),
    );
    await reply.status(204).send();
  }
}
