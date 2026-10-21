import { describe, expect, it } from 'vitest';
import { type Member, sortTeam, toAddMemberRequest, validateNewMember } from '../team-rules';

describe('validateNewMember', () => {
  it('a valid mobile and a name', () => {
    expect(validateNewMember({ phone: '98765 43210', name: 'Ravi', role: 'teacher' })).toEqual({});
    expect(validateNewMember({ phone: '12345', name: ' ', role: 'staff' })).toEqual({
      phone: 'team.phoneInvalid',
      name: 'team.nameInvalid',
    });
  });

  it('tidied when sent', () => {
    expect(
      toAddMemberRequest({ phone: ' 9876543210 ', name: ' Ravi  Kumar', role: 'staff' }),
    ).toEqual({ phone: '9876543210', name: 'Ravi Kumar', role: 'staff' });
  });
});

describe('sortTeam', () => {
  it('owner, teachers, staff; by name', () => {
    const m = (name: string, role: Member['role']): Member => ({
      userId: name,
      name,
      phone: '+919876543210',
      role,
    });
    expect(
      sortTeam([
        m('Zoya', 'staff'),
        m('Ravi', 'teacher'),
        m('Neha', 'owner'),
        m('Amit', 'teacher'),
      ]).map((x) => x.name),
    ).toEqual(['Neha', 'Amit', 'Ravi', 'Zoya']);
  });
});
