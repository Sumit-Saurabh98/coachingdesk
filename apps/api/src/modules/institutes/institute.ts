import { AppError, LocalDate } from '@coachingdesk/shared';

export const INSTITUTE_TYPES = ['tuition', 'academy', 'home_tutor'] as const;
export type InstituteType = (typeof INSTITUTE_TYPES)[number];

/** What an owner types when creating an institute (POST /v1/institutes). */
export interface NewInstituteInput {
  name: string;
  type: InstituteType;
  city?: string | null;
}

export interface DetailsChanges {
  name?: string;
  city?: string | null;
}

export interface BillingSettingsChanges {
  billingDay?: number;
  dueAfterDays?: number;
}

/** Institute-wide preferences (institutes.settings jsonb; API_DOCS "settings shape"). */
export interface InstituteSettings {
  absenceAlerts: boolean; // FR-3.3: "if absence alerts are enabled"
  messageLanguage: 'en' | 'hi';
  /**
   * FR-5.1: days BEFORE the due date to send a fee reminder (0 = on the due date, negative =
   * after it). Default: 3 before, on the day, 3 and 7 after. [] = automatic reminders off.
   */
  reminderOffsets: number[];
}

const DEFAULT_SETTINGS: InstituteSettings = {
  absenceAlerts: true,
  messageLanguage: 'en',
  reminderOffsets: [3, 0, -3, -7],
};

/**
 * Reads the stored JSON leniently: missing or unknown keys fall back to the defaults, so an
 * older row (or a future key this code doesn't know) never breaks loading an institute.
 */
export function parseSettings(json: unknown): InstituteSettings {
  const raw = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  return {
    absenceAlerts:
      typeof raw.absenceAlerts === 'boolean' ? raw.absenceAlerts : DEFAULT_SETTINGS.absenceAlerts,
    messageLanguage: raw.messageLanguage === 'hi' ? 'hi' : DEFAULT_SETTINGS.messageLanguage,
    reminderOffsets: parseOffsets(raw.reminderOffsets),
  };
}

/** Whole days within a month either side, no repeats, at most 6; anything else -> default. */
function parseOffsets(value: unknown): number[] {
  const valid =
    Array.isArray(value) &&
    value.length <= 6 &&
    value.every((n) => Number.isInteger(n) && n >= -30 && n <= 30) &&
    new Set(value).size === value.length;
  return valid ? [...(value as number[])] : [...DEFAULT_SETTINGS.reminderOffsets];
}

/** Every field of an institute, as stored. Used by restore() when loading from the database. */
export interface InstituteProps {
  id: string;
  name: string;
  type: InstituteType;
  city: string | null;
  timezone: string;
  billingDay: number;
  dueAfterDays: number;
  createdBy: string;
  archivedAt: Date | null;
  settings: InstituteSettings;
  /** Owner asked to delete the institute (FR-7.7); null = not pending. */
  deletionRequestedAt: Date | null;
}

/** FR-7.7: a deleted institute can be restored for 30 days, then everything is purged. */
export const DELETION_UNDO_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Defaults from docs/LLD.md §2.1 and KNOWLEDGE_BASE §3: bill on the 1st, due 6 days later (the 7th).
const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_BILLING_DAY = 1;
const DEFAULT_DUE_AFTER_DAYS = 6;

/**
 * The tenant: a tuition center, academy or home tutor. Everything else (batches, students,
 * fees) will belong to exactly one institute.
 *
 * Like User, it's immutable: changes return a new Institute.
 */
export class Institute {
  readonly id: string;
  readonly name: string;
  readonly type: InstituteType;
  readonly city: string | null;
  readonly timezone: string;
  readonly billingDay: number;
  readonly dueAfterDays: number;
  readonly createdBy: string;
  readonly archivedAt: Date | null;
  readonly settings: InstituteSettings;
  readonly deletionRequestedAt: Date | null;

  // private: the only ways in are create() (new, validated) and restore() (from storage).
  // With 9 fields, a props OBJECT is safer than 9 positional parameters you could mix up.
  private constructor(props: InstituteProps) {
    this.id = props.id;
    this.name = props.name;
    this.type = props.type;
    this.city = props.city;
    this.timezone = props.timezone;
    this.billingDay = props.billingDay;
    this.dueAfterDays = props.dueAfterDays;
    this.createdBy = props.createdBy;
    this.archivedAt = props.archivedAt;
    this.settings = props.settings;
    this.deletionRequestedAt = props.deletionRequestedAt;
  }

  /**
   * Named constructor #1: a brand-new institute. Validates the input and applies the defaults.
   * "Under 2 minutes" setup (F-02): only name and type are required.
   */
  static create(id: string, input: NewInstituteInput, createdBy: string): Institute {
    if (!INSTITUTE_TYPES.includes(input.type)) {
      throw invalid('type', `Type must be one of: ${INSTITUTE_TYPES.join(', ')}`);
    }
    return new Institute({
      id,
      name: cleanName(input.name),
      type: input.type,
      city: cleanCity(input.city),
      timezone: DEFAULT_TIMEZONE,
      billingDay: DEFAULT_BILLING_DAY,
      dueAfterDays: DEFAULT_DUE_AFTER_DAYS,
      createdBy,
      archivedAt: null,
      settings: { ...DEFAULT_SETTINGS, reminderOffsets: [...DEFAULT_SETTINGS.reminderOffsets] },
      deletionRequestedAt: null,
    });
  }

  /**
   * Named constructor #2: rebuild an institute that already exists (loaded by the repository).
   * The data was validated when it was created, and the DB CHECK constraints guard it, so we
   * only re-check the parts the business logic below depends on.
   */
  static restore(props: InstituteProps): Institute {
    assertValidTimezone(props.timezone);
    assertBillingDay(props.billingDay);
    assertDueAfterDays(props.dueAfterDays);
    return new Institute(props);
  }

  /** Returns a new Institute with a changed name and/or city (same rules as create). */
  withDetails(changes: DetailsChanges): Institute {
    const name = changes.name === undefined ? this.name : cleanName(changes.name);
    const city = changes.city === undefined ? this.city : cleanCity(changes.city);
    return new Institute({ ...this.toProps(), name, city });
  }

  /** Returns a new Institute with changed billing settings. Applies from the NEXT period (LLD §6.1). */
  withBillingSettings(changes: BillingSettingsChanges): Institute {
    const billingDay = changes.billingDay ?? this.billingDay;
    const dueAfterDays = changes.dueAfterDays ?? this.dueAfterDays;
    assertBillingDay(billingDay);
    assertDueAfterDays(dueAfterDays);
    return new Institute({ ...this.toProps(), billingDay, dueAfterDays });
  }

  /**
   * Returns a new Institute with changed settings (owner, PATCH). Unlike parseSettings (lenient,
   * for stored data), this is STRICT: a bad value is the owner's mistake and gets a 422.
   */
  withSettings(changes: Partial<InstituteSettings>): Institute {
    const offsets = changes.reminderOffsets;
    if (offsets !== undefined) {
      const valid =
        offsets.length <= 6 &&
        offsets.every((n) => Number.isInteger(n) && n >= -30 && n <= 30) &&
        new Set(offsets).size === offsets.length;
      if (!valid) {
        throw invalid(
          'settings.reminderOffsets',
          'Reminder days must be up to 6 different whole numbers from -30 to 30',
        );
      }
    }
    return new Institute({
      ...this.toProps(),
      settings: {
        absenceAlerts: changes.absenceAlerts ?? this.settings.absenceAlerts,
        messageLanguage: changes.messageLanguage ?? this.settings.messageLanguage,
        reminderOffsets: offsets ? [...offsets] : [...this.settings.reminderOffsets],
      },
    });
  }

  /**
   * Which billing period does `date` fall in? Returns that period's first day:
   * the latest billing day on or before `date`. With billing day 5:
   *   4 Oct -> 5 Sep  (October's period hasn't started yet)
   *   5 Oct -> 5 Oct
   */
  periodStartOn(date: LocalDate): LocalDate {
    // billingDay is 1-28, so every month has it: no "31st of February" problem (that's WHY it's 28).
    const thisMonth = LocalDate.of(date.year, date.month, this.billingDay);
    return date.isBefore(thisMonth) ? thisMonth.addMonths(-1) : thisMonth;
  }

  /** The due date for a period: billing day + dueAfterDays (default 1st + 6 = the 7th). */
  dueDateFor(periodStart: LocalDate): LocalDate {
    return periodStart.addDays(this.dueAfterDays);
  }

  toPublicJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      city: this.city,
      timezone: this.timezone,
      billingDay: this.billingDay,
      dueAfterDays: this.dueAfterDays,
      settings: this.settings,
    };
  }

  toProps(): InstituteProps {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      city: this.city,
      timezone: this.timezone,
      billingDay: this.billingDay,
      dueAfterDays: this.dueAfterDays,
      createdBy: this.createdBy,
      archivedAt: this.archivedAt,
      settings: this.settings,
      deletionRequestedAt: this.deletionRequestedAt,
    };
  }

  get isPendingDeletion(): boolean {
    return this.deletionRequestedAt !== null;
  }

  /** When the purge may run: 30 days after the request. null when not pending. */
  get purgeAfter(): Date | null {
    return this.deletionRequestedAt === null
      ? null
      : new Date(this.deletionRequestedAt.getTime() + DELETION_UNDO_DAYS * DAY_MS);
  }
}

// --- rules (private to this file: not exported) ---

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw invalid('name', 'Institute name must be 2 to 80 characters');
  }
  return name;
}

function cleanCity(raw: string | null | undefined): string | null {
  const city = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (city.length > 60) {
    throw invalid('city', 'City must be at most 60 characters');
  }
  return city === '' ? null : city; // an empty city is "not given", not a city called ""
}

function assertBillingDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    throw invalid('billingDay', 'Billing day must be a whole number from 1 to 28');
  }
}

function assertDueAfterDays(days: number): void {
  // Due date must stay inside the period, before the next bill is generated.
  if (!Number.isInteger(days) || days < 0 || days > 27) {
    throw invalid('dueAfterDays', 'Due after days must be a whole number from 0 to 27');
  }
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw invalid('timezone', `Unknown time zone: ${timezone}`);
  }
}

function invalid(field: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, { field });
}
