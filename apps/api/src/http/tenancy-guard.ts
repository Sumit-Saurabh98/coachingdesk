import { AppError } from '@coachingdesk/shared';
import type { FastifyRequest } from 'fastify';
import type { MemberRole } from '../modules/institutes/institute.repository';
import { currentUserId } from './auth-guard';
import { isUuid } from './route-params';

export interface TenantContext {
  instituteId: string;
  role: MemberRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext | null;
  }
  interface FastifyContextConfig {
    /** A write the owner may still make while the institute is pending deletion (cancel, export). */
    allowWhilePendingDeletion?: boolean;
  }
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** What the guard needs: one question, "is this user a member, and with which role?" (ISP). */
export interface MembershipLookup {
  findMembership(
    instituteId: string,
    userId: string,
  ): Promise<{ role: MemberRole; pendingDeletion: boolean } | null>;
}

/**
 * Tenancy guard for every `/v1/institutes/:instituteId/...` route (AGENTS.md rule 1).
 * Must run AFTER requireAuth: [requireAuth, requireMember].
 *
 * Not a member -> 404, not 403. A 403 would confirm "this institute exists, you just can't
 * see it"; 404 reveals nothing. A wrong id and someone else's id look exactly the same.
 */
export function createTenancyGuard(memberships: MembershipLookup) {
  return async function requireMember(request: FastifyRequest): Promise<void> {
    const userId = currentUserId(request);
    const { instituteId } = request.params as { instituteId?: string };
    // Check the shape first: Postgres would reject a non-UUID with an error (a 500, not a 404).
    if (!isUuid(instituteId)) {
      throw instituteNotFound();
    }
    const membership = await memberships.findMembership(instituteId.toLowerCase(), userId);
    if (!membership) {
      throw instituteNotFound();
    }
    if (membership.pendingDeletion) {
      // FR-7.7: the institute is on its way out. Teachers and staff have lost access already;
      // the owner may look, export and cancel, but nothing changes while it waits for the purge.
      if (membership.role !== 'owner') {
        throw instituteNotFound();
      }
      if (
        !READ_METHODS.has(request.method) &&
        request.routeOptions.config.allowWhilePendingDeletion !== true
      ) {
        throw new AppError(
          'INSTITUTE_PENDING_DELETION',
          'This institute is scheduled for deletion. Cancel the deletion to make changes.',
        );
      }
    }
    request.tenant = { instituteId: instituteId.toLowerCase(), role: membership.role };
  };
}

/** Use after requireMember: [requireAuth, requireMember, requireRole('owner')]. */
export function requireRole(...allowed: MemberRole[]) {
  return async function checkRole(request: FastifyRequest): Promise<void> {
    if (!allowed.includes(currentTenant(request).role)) {
      // The user IS a member (so the institute's existence isn't secret to them): 403 is honest here.
      throw new AppError('FORBIDDEN', 'You do not have permission to do this.');
    }
  };
}

/**
 * Controllers get the institute id HERE, never from the URL or body directly: this value was
 * checked against the user's memberships. (AGENTS.md: never trust an instituteId from the request.)
 */
export function currentTenant(request: FastifyRequest): TenantContext {
  if (!request.tenant) {
    throw new Error('currentTenant() called on a route without the requireMember guard');
  }
  return request.tenant;
}

function instituteNotFound(): AppError {
  return new AppError('NOT_FOUND', 'Institute not found');
}
