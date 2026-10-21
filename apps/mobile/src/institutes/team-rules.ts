// Pure TypeScript: the team screen's rules, unit-tested in Node.
import { isValidIndianPhone } from '../students/student-form-rules';

export type MemberRole = 'owner' | 'teacher' | 'staff';

export interface Member {
  userId: string;
  name: string | null;
  phone: string; // E.164
  role: MemberRole;
}

export interface NewMemberValues {
  phone: string;
  name: string;
  role: 'teacher' | 'staff';
}

export type NewMemberError = 'team.phoneInvalid' | 'team.nameInvalid';

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

/** A valid Indian mobile (the same rule as everywhere) and a name to recognise them by. */
export function validateNewMember(
  values: NewMemberValues,
): Partial<Record<'phone' | 'name', NewMemberError>> {
  const errors: Partial<Record<'phone' | 'name', NewMemberError>> = {};
  if (!isValidIndianPhone(values.phone)) {
    errors.phone = 'team.phoneInvalid';
  }
  const name = tidy(values.name);
  if (name.length < 2 || name.length > 80) {
    errors.name = 'team.nameInvalid';
  }
  return errors;
}

export function toAddMemberRequest(values: NewMemberValues) {
  return { phone: values.phone.trim(), name: tidy(values.name), role: values.role };
}

/** Owner first, then teachers, then staff; by name within each. */
export function sortTeam(members: readonly Member[]): Member[] {
  const rank: Record<MemberRole, number> = { owner: 0, teacher: 1, staff: 2 };
  return [...members].sort(
    (a, b) => rank[a.role] - rank[b.role] || (a.name ?? '').localeCompare(b.name ?? ''),
  );
}
