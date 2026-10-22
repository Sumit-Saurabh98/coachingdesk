/** One "I agree" to the Terms and Privacy Policy (KB #54). */
export interface TermsAcceptance {
  id: string;
  userId: string;
  version: string;
  acceptedAt: Date;
}

export interface TermsAcceptanceRepository {
  /** Appends to the user's history (an old acceptance is never overwritten: it's proof). */
  record(acceptance: TermsAcceptance): Promise<void>;
  /** The version this user accepted most recently; null when they never have. */
  latestVersion(userId: string): Promise<string | null>;
  /** Account deletion: the user's whole history goes with them. */
  deleteAllFor(userId: string): Promise<void>;
}

/** Tests and local dev only. */
export class InMemoryTermsAcceptanceRepository implements TermsAcceptanceRepository {
  private readonly rows: TermsAcceptance[] = [];

  async record(acceptance: TermsAcceptance): Promise<void> {
    this.rows.push({ ...acceptance });
  }

  async latestVersion(userId: string): Promise<string | null> {
    const mine = this.rows.filter((row) => row.userId === userId);
    if (mine.length === 0) {
      return null;
    }
    // Same tie-break as the SQL version: latest acceptedAt, then the latest id (UUIDv7 sorts by time).
    const latest = mine.reduce((a, b) =>
      b.acceptedAt > a.acceptedAt || (+b.acceptedAt === +a.acceptedAt && b.id > a.id) ? b : a,
    );
    return latest.version;
  }

  async deleteAllFor(userId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]!.userId === userId) {
        this.rows.splice(i, 1);
      }
    }
  }
}
