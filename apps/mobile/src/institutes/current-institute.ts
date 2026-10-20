// Pure TypeScript (no React Native imports): unit-tested in Node.

/** An institute the user belongs to, with their role there (GET /v1/me). */
export interface MyInstitute {
  id: string;
  name: string;
  type: 'tuition' | 'academy' | 'home_tutor';
  role: 'owner' | 'teacher' | 'staff';
}

/**
 * Which institute the app works in right now:
 *  - the one chosen earlier on this phone, if the user still belongs to it;
 *  - otherwise, when there's exactly ONE, that one (nothing to choose);
 *  - otherwise none: the user creates one (0) or picks one (several).
 * Derived on every render, never stored as a second copy that could go stale (e.g. after
 * being removed from an institute, or another person logging in on this phone).
 */
export function pickCurrentInstitute(
  institutes: readonly MyInstitute[],
  savedId: string | null,
): MyInstitute | null {
  const saved = institutes.find((institute) => institute.id === savedId);
  if (saved) {
    return saved;
  }
  return institutes.length === 1 ? (institutes[0] ?? null) : null;
}
