// Pure TypeScript: the "add student" form's rules, unit-tested in Node. They mirror the API
// (Student.create); the API checks again and decides.
import { CreateStudentBody } from '@coachingdesk/shared';

export interface StudentFormValues {
  name: string;
  guardianName: string;
  guardianPhone: string; // as typed: any common Indian format
  joinedOn: string | null; // "YYYY-MM-DD"; null = today at the institute (the API's default)
  notes: string;
  batchIds: string[];
  guardianConsent: boolean;
}

export type StudentFormField = 'name' | 'guardianName' | 'guardianPhone' | 'notes';
/** Problems per field: the value is the i18n key of the message. */
export type StudentFormErrors = Partial<Record<StudentFormField, string>>;

/**
 * What POST /students receives. Its own type because the shared Zod schema's TypeScript type
 * describes the PARSED body (guardianPhone becomes a PhoneNumber, joinedOn a LocalDate), while
 * the app sends plain strings.
 */
export interface CreateStudentRequest {
  name: string;
  guardianName: string | null;
  guardianPhone: string;
  joinedOn?: string;
  notes: string | null;
  batchIds?: string[];
  guardianConsent: boolean;
}

export const NEW_STUDENT: StudentFormValues = {
  name: '',
  guardianName: '',
  guardianPhone: '',
  joinedOn: null,
  notes: '',
  batchIds: [],
  guardianConsent: false, // consent must be a real "yes", never pre-ticked (KB "Messaging")
};

const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The SAME phone rule as the API (shared zPhoneIN): Indian mobile, many input formats. */
export function isValidIndianPhone(text: string): boolean {
  return CreateStudentBody.shape.guardianPhone.safeParse(text).success;
}

export function validateStudentForm(values: StudentFormValues): StudentFormErrors {
  const errors: StudentFormErrors = {};
  const name = tidy(values.name);
  if (name.length < 2 || name.length > 80) {
    errors.name = 'studentForm.nameInvalid';
  }
  if (tidy(values.guardianName).length > 80) {
    errors.guardianName = 'studentForm.guardianNameInvalid';
  }
  if (!isValidIndianPhone(values.guardianPhone)) {
    errors.guardianPhone = 'studentForm.phoneInvalid';
  }
  if (values.notes.trim().length > 1000) {
    errors.notes = 'studentForm.notesInvalid';
  }
  return errors;
}

export function toCreateStudentRequest(values: StudentFormValues): CreateStudentRequest {
  const guardianName = tidy(values.guardianName);
  const notes = values.notes.trim();
  return {
    name: tidy(values.name),
    guardianName: guardianName === '' ? null : guardianName,
    guardianPhone: values.guardianPhone.trim(),
    ...(values.joinedOn ? { joinedOn: values.joinedOn } : {}),
    notes: notes === '' ? null : notes,
    ...(values.batchIds.length > 0 ? { batchIds: values.batchIds } : {}),
    guardianConsent: values.guardianConsent,
  };
}

/** What PATCH /students/:id receives: only the fields that changed. */
export interface UpdateStudentRequest {
  name?: string;
  guardianName?: string | null;
  guardianPhone?: string;
  joinedOn?: string;
  notes?: string | null;
}

/** The fields the edit screen works with (a student as the API returns it). */
export interface EditableStudent {
  name: string;
  guardianName: string | null;
  guardianPhone: string | null;
  joinedOn: string;
  notes: string | null;
}

/** The form's starting values for an existing student. */
export function valuesFromStudent(student: EditableStudent): StudentFormValues {
  return {
    ...NEW_STUDENT,
    name: student.name,
    guardianName: student.guardianName ?? '',
    guardianPhone: student.guardianPhone ?? '',
    joinedOn: student.joinedOn,
    notes: student.notes ?? '',
  };
}

/**
 * The same number, however it's written: "98765 43210", "+919876543210" and "09876543210"
 * are one phone. Uses the shared rule's normalisation (E.164).
 */
export function samePhone(a: string, b: string | null): boolean {
  const phone = CreateStudentBody.shape.guardianPhone;
  const left = phone.safeParse(a);
  const right = phone.safeParse(b ?? '');
  return left.success && right.success && left.data.toE164() === right.data.toE164();
}

/** PATCH body with only what changed; null when nothing did (then no request is sent). */
export function toUpdateStudentRequest(
  original: EditableStudent,
  values: StudentFormValues,
): UpdateStudentRequest | null {
  const next = toCreateStudentRequest(values);
  const body: UpdateStudentRequest = {};
  if (next.name !== original.name) {
    body.name = next.name;
  }
  if (next.guardianName !== original.guardianName) {
    body.guardianName = next.guardianName;
  }
  if (!samePhone(next.guardianPhone, original.guardianPhone)) {
    body.guardianPhone = next.guardianPhone;
  }
  if (next.joinedOn !== undefined && next.joinedOn !== original.joinedOn) {
    body.joinedOn = next.joinedOn;
  }
  if (next.notes !== original.notes) {
    body.notes = next.notes;
  }
  return Object.keys(body).length === 0 ? null : body;
}
