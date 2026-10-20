import { createDb } from '@coachingdesk/db';
import {
  InstituteClock,
  type LocalDate,
  PhoneNumber,
  SystemClock,
  UuidV7Generator,
} from '@coachingdesk/shared';
import { createDomainServices } from '../services';

/**
 * `pnpm db:seed`: a demo institute to click through (local dev, demos, app screenshots).
 * Built through the real domain services, so every row is one the app could have made:
 * invoices from the billing run, receipts with numbers, attendance through sync.
 * Safe to run twice (a second run sees the demo institute and stops). Never in production.
 */
const DEMO_NAME = 'Demo Classes';
const OWNER_PHONE = process.env.SEED_OWNER_PHONE ?? '9999900001';
const TEACHER_PHONE = process.env.SEED_TEACHER_PHONE ?? '9999900002';

const STUDENTS = [
  ['Aarav Sharma', 'Rakesh Sharma'],
  ['Diya Patel', 'Meena Patel'],
  ['Kabir Singh', 'Harpreet Singh'],
  ['Ananya Iyer', 'Lakshmi Iyer'],
  ['Vihaan Gupta', 'Sunil Gupta'],
  ['Ishita Reddy', 'Kavitha Reddy'],
  ['Arjun Nair', 'Suresh Nair'],
  ['Saanvi Joshi', 'Pooja Joshi'],
  ['Reyansh Khan', 'Imran Khan'],
  ['Myra Das', 'Ritu Das'],
  ['Aditya Verma', 'Anil Verma'],
  ['Kiara Mehta', 'Neha Mehta'],
] as const;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data in production');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }
  const clock = new SystemClock();
  const database = createDb(databaseUrl);
  const s = createDomainServices(database.db, clock, new UuidV7Generator(clock));
  try {
    const { user: owner } = await s.userService.findOrCreateByPhone(PhoneNumber.parse(OWNER_PHONE));
    if ((await s.instituteService.listForUser(owner.id)).some((i) => i.name === DEMO_NAME)) {
      console.log(`Already seeded: log in as ${OWNER_PHONE} (OTP is printed in the API log).`);
      return;
    }
    await s.userService.updateProfile(owner.id, { name: 'Demo Owner' });
    const { institute } = await s.instituteService.create(owner.id, {
      name: DEMO_NAME,
      type: 'tuition',
      city: 'Pune',
    });
    const id = institute.id;
    await s.instituteService.addMember(
      id,
      { phone: PhoneNumber.parse(TEACHER_PHONE), name: 'Demo Teacher', role: 'teacher' },
      owner.id,
    );
    const today = new InstituteClock(clock, institute.timezone).today();

    const maths = await s.batchService.create(id, {
      name: 'Class 10 Maths',
      subject: 'Maths',
      schedule: { days: [1, 3, 5], start: '17:00', end: '18:00' },
      defaultFeePaise: 150000,
      defaultFeeCycle: 'monthly',
    });
    const science = await s.batchService.create(id, {
      name: 'Class 9 Science',
      subject: 'Science',
      schedule: { days: [2, 4], start: '16:00', end: '17:00' },
      defaultFeePaise: 120000,
      defaultFeeCycle: 'monthly',
    });
    const english = await s.batchService.create(id, {
      name: 'Spoken English',
      subject: null,
      schedule: { days: [6], start: '10:00', end: '11:30' },
      defaultFeePaise: 200000,
      defaultFeeCycle: 'quarterly',
    });

    // Siblings share a guardian: the last two students are Aarav's and Diya's siblings.
    const joinedOn = today.addDays(-60);
    const students = [];
    for (const [index, [name, guardianName]] of STUDENTS.entries()) {
      const guardianIndex = index >= 10 ? index - 10 : index;
      const guardianPhone = PhoneNumber.parse(
        `98000000${String(guardianIndex + 10).padStart(2, '0')}`,
      );
      const student = await s.studentService.create(id, {
        name,
        guardianName: index >= 10 ? STUDENTS[guardianIndex]?.[1] : guardianName,
        guardianPhone,
        joinedOn,
      });
      await s.consentService.optIn(id, guardianPhone, 'add_student');
      const batches = index % 3 === 0 ? [maths, english] : index % 3 === 1 ? [maths] : [science];
      for (const batch of batches) {
        await s.enrollmentService.enroll(id, {
          studentId: student.id,
          batchId: batch.id,
          startDate: joinedOn,
        });
      }
      students.push(student);
    }

    // This period's invoices, then some paid in full, some in part, the rest open.
    await s.invoiceGenerator.runDue(id);
    const open = await s.invoiceService.openForStudents(
      id,
      students.map((x) => x.id),
    );
    for (const [index, invoice] of open.entries()) {
      if (index % 3 === 2) continue; // stays due
      const amountPaise = index % 3 === 0 ? invoice.remaining.toPaise() : 50000;
      await s.paymentService.recordOffline(
        id,
        owner.id,
        invoice.id,
        { amountPaise, method: index % 2 ? 'cash' : 'bank' },
        `seed-${invoice.id}`,
      );
    }

    // The last week of Maths attendance (the 7-day edit window), one or two absent each day.
    const enrolledInMaths = await s.enrollmentService.studentIdsInBatchOn(id, maths.id, today);
    for (let back = 6; back >= 0; back--) {
      const date: LocalDate = today.addDays(-back);
      if (!maths.schedule.runsOn(date)) continue;
      await s.attendanceService.sync(id, owner.id, crypto.randomUUID(), {
        batchId: maths.id,
        date,
        records: enrolledInMaths.map((studentId, i) => ({
          studentId,
          status: (i + back) % 5 === 0 ? 'absent' : 'present',
        })),
      });
    }

    // A class test with marks.
    const test = await s.testService.create(id, maths.id, owner.id, {
      name: 'Unit 3: Quadratic equations',
      date: today.addDays(-2),
      maxMarks: 50,
    });
    await s.testService.saveScores(id, test.id, owner.id, {
      scores: enrolledInMaths.map((studentId, i) =>
        i === 1 ? { studentId, isAbsent: true } : { studentId, marks: 28 + ((i * 7) % 22) + 0.5 },
      ),
    });

    console.log(
      [
        `Seeded "${DEMO_NAME}": ${students.length} students, 3 batches, invoices, payments, attendance, a test.`,
        `Owner: ${OWNER_PHONE} · Teacher: ${TEACHER_PHONE} (OTP is printed in the API log).`,
      ].join('\n'),
    );
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
