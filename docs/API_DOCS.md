# API_DOCS.md

Base URL: `https://api.<domain>/v1` · JSON only · OpenAPI spec generated from Zod schemas at `/v1/openapi.json` (non-prod).

## 1. Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <accessToken>` (except `/auth/*`, `/public/*`, `/webhooks/*`) |
| Tenancy | Tenant routes are under `/institutes/{instituteId}/...`; caller must be a member |
| Idempotency | All POST/PUT from mobile send `Idempotency-Key: <uuid>`; server caches the response for 24 h |
| Money | Integer **paise** in field names ending `Paise` (e.g. `amountPaise: 50000` = ₹500) |
| Dates | `date` = `YYYY-MM-DD` (institute local); `timestamp` = ISO-8601 UTC |
| Phones | E.164 (`+919876543210`); API also accepts 10-digit Indian numbers and normalizes |
| Pagination | Cursor: `?limit=50&cursor=<opaque>` → `{ items, nextCursor }` |
| Errors | `{ "error": { "code", "message", "details" }, "requestId" }` |
| Rate limits | `429` with `Retry-After` |

### Common error codes

`UNAUTHENTICATED` 401 · `FORBIDDEN` 403 · `NOT_FOUND` 404 · `VALIDATION_FAILED` 422 · `CONFLICT` 409 · `NOTHING_DUE` 409 · `ALREADY_REMINDED_TODAY` 409 · `OWNER_OF_INSTITUTES` 409 · `DAILY_LIMIT_REACHED` 429 · `PLAN_LIMIT_REACHED` 402 · `FEATURE_NOT_IN_PLAN` 402 · `OTP_INVALID` 400 · `OTP_EXPIRED` 400 · `RATE_LIMITED` 429 · `SERVICE_UNAVAILABLE` 503 (e.g. daily OTP budget used up) · `INTERNAL` 500

### Roles

| Endpoint group | owner | teacher | staff |
|---|---|---|---|
| Institute settings, members, plan | ✅ | ❌ | ❌ |
| Batches, students — read | ✅ | ✅ | ✅ |
| Batches, students, enrollments — write | ✅ | ❌ | ✅ |
| Attendance — write | ✅ | ✅ | ✅ |
| Tests & marks — write | ✅ | ✅ | ❌ |
| Notices — send | ✅ | ✅ | ✅ |
| Fees dashboard, invoices, payments — read | ✅ | ❌ | ✅ |
| Record offline payment, remind now | ✅ | ❌ | ✅ |
| Create manual invoice, waive, cancel, void payment, `force` remind | ✅ | ❌ | ❌ |

Roles are institute-wide in MVP (`memberships.batch_scope` stays null). Fixed per role — not configurable — so it can be tested exhaustively. Source: REQUIREMENTS FR-1.4.

**Teachers never see fees.** Where a teacher may read something that carries money, the money fields are left out of the response: `defaultFeePaise` on batches; `feePaise`, `discountPaise`, `netFeePaise`, `feeCycle` on enrollments.

---

## 2. Auth

### `POST /auth/otp/request`
```json
{ "phone": "+919876543210" }
```
→ `204`. Rate-limited per phone and IP.
- Only Indian mobile numbers (`+91`, starting 6–9) are accepted; anything else → `422 VALIDATION_FAILED`. This blocks SMS-pumping fraud via premium international numbers.
- A global daily OTP-send budget (config) raises an alert at 80% and stops sending at 100%.
- **Store-review login:** one configured number (`REVIEW_LOGIN_PHONE`) accepts a fixed OTP (`REVIEW_LOGIN_OTP`, from Secrets Manager) and sends no SMS. It is tied to a seeded demo institute and every login with it is audited. Give it to Play/App Store reviewers.

### `POST /auth/otp/verify`
```json
{ "phone": "+919876543210", "otp": "482913", "device": { "platform": "android", "appVersion": "1.0.0" } }
```
→ `200`
```json
{ "accessToken": "...", "refreshToken": "...", "user": { "id": "...", "name": null, "locale": "en" }, "isNewUser": true }
```

### `POST /auth/refresh`
`{ "refreshToken": "..." }` → new pair. Reusing an old refresh token revokes the whole session family.

### `POST /auth/logout`
`{ "refreshToken": "..." }` → `204`.

## 3. Me

| Method | Path | Description |
|---|---|---|
| GET | `/me` | Profile + institutes with role |
| PATCH | `/me` | `{ name?, locale? }` |
| DELETE | `/me` | Delete own account → `204`: all sessions end (refresh tokens deleted), the user leaves every institute, the user row is deleted; the phone can sign up again as a new user. `409 OWNER_OF_INSTITUTES` while owner of an institute. Same flow on the web at `/delete-account` (OTP login), as Google Play requires |

## 4. Institutes & members

| Method | Path | Body / notes |
|---|---|---|
| POST | `/institutes` | `{ name, type: "tuition"\|"academy"\|"home_tutor", city? }` → creates owner membership + 30-day Pro trial |
| GET | `/institutes/{id}` | Any member → `200 { institute (incl. settings), role, entitlements: { plan, maxActiveStudents, maxMembers, monthlyMessages, features } }`. The app shows/hides features from `entitlements`, never from plan names |
| PATCH | `/institutes/{id}` | Owner. `{ name?, city?, billingDay?, dueAfterDays?, settings? }`; `settings` is partial: `{ absenceAlerts?: boolean, messageLanguage?: "en"\|"hi", reminderOffsets?: number[] }` (≤ 6 different whole days, −30…30; `[]` = no automatic reminders) → `200 { institute }`. Unknown stored settings keys are kept |
| GET | `/institutes/{id}/members` | Owner. `200 { members: [{ userId, name, phone, role }] }`, owner first |
| POST | `/institutes/{id}/members` | Owner. `{ phone, name, role: "teacher"\|"staff" }` → `201 { member }` — adds by phone. Creates the `users` row if the phone is new; they get access on first OTP login. `name` is used only if the person hasn't set their own. `409` already a member; member count (excluding owner) checked against plan atomically → `402 PLAN_LIMIT_REACHED` |
| DELETE | `/institutes/{id}/members/{userId}` | Owner. Remove → `204`; they lose access immediately. `409` for the owner, `404` not a member |
| GET | `/institutes/{id}/payouts` | `{ status: "not_started"\|"pending"\|"active"\|"rejected", upiVpa, providerMessage? }` |
| POST | `/institutes/{id}/payouts/onboarding` | Starts provider linked-account KYC → `{ onboardingUrl }`. Status updates arrive via provider webhook |
| PUT | `/institutes/{id}/payouts/upi` | `{ upiVpa }` — institute's own UPI ID, shown on the pay page until payouts are active (validated format `name@bank`) |
| POST | `/institutes/{id}/exports` | Owner. Starts a full data export → `{ exportId }` |
| GET | `/institutes/{id}/exports/{exportId}` | `{ status, downloadUrl? }` — signed URL valid 24 h |
| POST | `/institutes/{id}/delete` | Owner. `{ otp }` (fresh OTP required). Stops messaging/billing; purged after 30 days |
| POST | `/institutes/{id}/delete/cancel` | Owner. Cancels a pending deletion within the 30 days |

`POST /institutes` → `201`:
```json
{
  "institute": { "id": "…", "name": "Sharma Classes", "type": "tuition", "city": "Pune", "timezone": "Asia/Kolkata", "billingDay": 1, "dueAfterDays": 6 },
  "role": "owner",
  "subscription": { "plan": "pro", "status": "trialing", "trialEndsAt": "2026-11-18T10:00:00.000Z" }
}
```
`GET /me` → `{ "user": { "id", "name", "locale" }, "institutes": [{ "id", "name", "type", "role" }] }`

`settings` shape (defaults shown; quiet hours are fixed at 21:00–08:00 in MVP):
```json
{ "absenceAlerts": true, "reminderOffsets": [3, 0, -3, -7], "messageLanguage": "en" }
```

## 5. Batches

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/batches` | `?includeArchived=true\|false` (default `false`) → `200 { batches: [...] }`, oldest first |
| POST | `/institutes/{id}/batches` | Owner, staff. See body → `201 { batch }` |
| GET | `/institutes/{id}/batches/{batchId}` | `200 { batch, enrolledCount }` — students enrolled today |
| PATCH | `/institutes/{id}/batches/{batchId}` | Owner, staff. Partial update (any body field; `schedule` is replaced whole) → `200 { batch }`. `409 CONFLICT` if archived |
| POST | `/institutes/{id}/batches/{batchId}/archive` | Owner, staff. No body → `200 { batch }`. Idempotent: a retry returns the same `archivedAt` |

```json
{
  "name": "Class 10 Maths – Evening",
  "subject": "Maths",
  "schedule": { "days": [1, 3, 5], "start": "17:00", "end": "18:00" },
  "defaultFeePaise": 150000,
  "defaultFeeCycle": "monthly"
}
```
`defaultFeeCycle` is copied to each new enrollment; changing it later doesn't change existing enrollments.

- `subject` optional; `defaultFeePaise` defaults to `0`, `defaultFeeCycle` to `"monthly"`. Cycles: `monthly`, `quarterly`, `half_yearly`, `yearly`, `one_time`, `none`.
- `schedule.days` are ISO weekdays (1 = Monday … 7 = Sunday), at least one, no repeats. `start`/`end` are institute-local `"HH:MM"` (24 h), `start < end` (no overnight batches).
- Name 2–80 characters, subject ≤ 60. Rule violations → `422 VALIDATION_FAILED` with `details.field`.
- A batch id from another institute, or one that isn't a UUID → `404 NOT_FOUND` (same as an unknown id).

Batch object:
```json
{ "id": "…", "name": "Class 10 Maths – Evening", "subject": "Maths", "schedule": { "days": [1, 3, 5], "start": "17:00", "end": "18:00" }, "defaultFeePaise": 150000, "defaultFeeCycle": "monthly", "archivedAt": null }
```

## 6. Students & enrollments

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/students` | `?q=&status=active\|left\|all&limit=1–100 (50)&cursor=` → `200 { students, nextCursor }`, sorted by name (case-insensitive). `q` matches student/guardian name, or 3+ digits of the guardian phone. `?batchId=` = only students enrolled in that batch today (unknown batch → empty list) |
| POST | `/institutes/{id}/students` | Owner, staff. Single student, optional `batchIds` (max 20) → `201 { student, enrollments, invoices }` (`invoices`: one_time batch fees, billed at once). Batches are checked first: unknown → `404`, archived → `409`, and then no student is created. Each enrollment uses the batch's default fee/cycle and starts on `joinedOn` |
| POST | `/institutes/{id}/students/bulk` | Owner, staff. Up to 500 rows → `200 { created, students, failed }` |
| GET | `/institutes/{id}/students/{studentId}` | `200 { student, enrollments }` (past and present, by start date). Fee summary and attendance % are added as those modules land |
| PATCH | `/institutes/{id}/students/{studentId}` | Owner, staff. `{ name?, guardianName?, guardianPhone?, joinedOn?, notes? }` → `200 { student }`. `409` if erased |
| POST | `/institutes/{id}/students/{studentId}/leave` | Owner, staff. `{ leftOn? }` (default: today at the institute) → `200 { student }`. Stops invoices/reminders; frees a plan slot. Idempotent: a retry keeps the first date |
| POST | `/institutes/{id}/students/{studentId}/erase` | Owner. `{ confirm: true }` → `200 { student }`. Irreversibly erases the student's personal data (on guardian request): name → "Erased student", guardian name/phone and notes cleared, marked left (billing stops); absence alerts about them lose their text. The guardian's phone is also removed from payments, consent and the message log **unless a sibling here still has it**. Invoice and payment amounts are kept. Audited; repeating it is harmless |
| POST | `/institutes/{id}/enrollments` | Owner, staff. `{ studentId, batchId, feePaise?, discountPaise?, feeCycle?, startDate?, billNow? }` → `201 { enrollment, invoice }`. `feePaise`/`feeCycle` default to the batch's, `startDate` to today at the institute. `one_time` is invoiced immediately; `billNow: true` bills the current period of a periodic enrollment now (`422` if the enrollment starts after this period); otherwise `invoice` is `null` and the billing run bills it. `404` student/batch not in this institute; `409` student left, batch archived, or already enrolled then |
| PATCH | `/institutes/{id}/enrollments/{enrollmentId}` | Owner, staff. `{ feePaise?, discountPaise?, feeCycle?, endDate? }` → `200 { enrollment }`. Fee changes apply from the next period; `endDate` = last day attending (can be corrected, not before `startDate`) |

Create student:
```json
{
  "name": "Aarav Sharma",
  "guardianName": "Neha Sharma",
  "guardianPhone": "9876543210",
  "joinedOn": "2026-10-18",
  "batchIds": ["0192..."]
}
```

- `guardianPhone`: any common Indian format (`98765 43210`, `+91…`); stored and returned as E.164. Siblings may share it.
- `joinedOn` default: today in the institute's time zone. `leftOn` ≥ `joinedOn`.
- Name 2–80 chars, guardian name ≤ 80, notes ≤ 1000. `status` is never sent: only `/leave` changes it.
- `guardianConsent: true` (create and bulk) records the guardian's WhatsApp consent (source `add_student`). Without consent no automatic message is sent to that guardian.

Enrollment object (owner/staff):
```json
{ "id": "…", "studentId": "…", "batchId": "…", "feePaise": 150000, "discountPaise": 20000, "netFeePaise": 130000, "feeCycle": "monthly", "startDate": "2026-10-19", "endDate": null }
```
Rules: discount ≤ fee; one open enrollment per student and batch (rejoining after `endDate` is fine); changing a batch's default fee never changes existing enrollments.

Student object:
```json
{ "id": "…", "name": "Aarav Sharma", "guardianName": "Neha Sharma", "guardianPhone": "+919876543210", "status": "active", "joinedOn": "2026-10-18", "leftOn": null, "notes": null }
```

List: `nextCursor` is opaque — send it back as `?cursor=` for the next page; `null` = last page. A tampered cursor → `422` (`details.field = "cursor"`).

Bulk request (the app parses pasted "Name, Phone" lines into rows; one `joinedOn` for all, optional):
```json
{ "rows": [ { "name": "Aarav", "guardianPhone": "9876543210", "guardianName": "Neha" }, { "name": "Ravi", "guardianPhone": "98765" } ], "joinedOn": "2026-10-01" }
```
Bulk response — every row is validated on its own; bad rows are reported, never silently dropped (FR-2.2):
```json
{ "created": 1, "students": [ { "id": "…", "name": "Aarav", … } ], "failed": [ { "row": 2, "field": "guardianPhone", "message": "…", "input": { "name": "Ravi", "guardianPhone": "98765" } } ] }
```

Errors: `402 PLAN_LIMIT_REACHED` (`details.limit`) when the new **active** students would exceed the plan. For bulk, all valid rows must fit or none are created. The count and the insert run under a lock, so two phones can't both take the last slot.

## 7. Attendance

Every member (owner, teacher, staff) can read and take attendance.

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/batches/{batchId}/attendance?date=2026-10-18` | The register → `200 { batchId, date, session \| null, students: [{ studentId, name, status, marked }] }`. Everyone enrolled that day plus anyone already marked; unmarked students show `status: "present"`, `marked: false` (FR-3.1) |
| PUT | `/institutes/{id}/attendance-sessions/{clientId}` | Idempotent upsert (offline sync), see below |
| GET | `/institutes/{id}/students/{studentId}/attendance?from&to` | `200 { from, to, records: [{ date, batchId, status }], summary: { present, absent, late, leave, percentage } }`. Range ≤ 1 year. `percentage` = (present + late) ÷ (all except leave), whole number, `null` if nothing counts |
| GET | `/institutes/{id}/attendance/summary?date=` | Default: today at the institute → `200 { date, batches: [{ batchId, name, start, end, taken, counts \| null }] }` — active batches that meet that weekday (or already have attendance), by start time |

PUT body (`clientId` = a UUID the phone generated offline; a retry with the same id is harmless):
```json
{
  "batchId": "0192...",
  "date": "2026-10-18",
  "records": [
    { "studentId": "0192...a", "status": "present" },
    { "studentId": "0192...b", "status": "absent" }
  ]
}
```
→ `200 { session: { id, batchId, date, clientId, takenBy, submittedAt }, records: [{ studentId, status }], alerts: { status, queued } }`

- Statuses: `present`, `absent`, `late`, `leave`. 1–500 records, each student once.
- **Merge:** another phone's sync for the same batch and date lands on the same session. Each sent mark replaces that student's mark; students not sent keep theirs. The sync the **server receives last** wins; `submittedAt` and record times are server time, never the phone's clock. The first phone's `clientId` and `takenBy` are kept.
- `422`: `date` after tomorrow or more than 7 days back (`details.field = "date"`); a student not enrolled in the batch on that date (`details: { field: "records", studentIds }`); `clientId` not a UUID. `404` batch not in this institute; `409` archived batch, or `clientId` already used for another batch/date.
- `alerts.status`: `queued` (one `absence_alert` per absent student queued in the outbox), `none_absent`, `already_sent` (alerts go out once per session; later edits don't resend, FR-3.4), `too_late` (synced at/after 10:00 the day after the class), `not_enabled` (plan without automatic messages, or the institute's `absenceAlerts` setting is off). Consent, quiet hours and "still absent?" are checked when the worker sends.

## 8. Fees

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/fees/dashboard?month=2026-10` | Owner, staff. `month` (default: this month, institute time) only affects `collectedPaise`/`byMethod`; `pendingPaise`, `overdueCount`, `topOverdue` (top 10 students, largest overdue first) are as of now |
| GET | `/institutes/{id}/invoices` | Owner, staff. `?status=due,partially_paid&studentId&batchId&overdue=true&limit=1–200 (100)` → `200 { invoices }`, oldest due date first. `overdue` = open and due before today (institute time) |
| GET | `/institutes/{id}/invoices/{invoiceId}` | Owner, staff → `200 { invoice, payments }`; each payment has `allocatedPaise` (what it paid on THIS invoice). Messages sent arrive with reminders |
| POST | `/institutes/{id}/invoices` | Owner. Manual one-off invoice `{ studentId, amountPaise, discountPaise?, dueDate, description }` (`description` required, 1–200 chars; discount < amount) → `201 { invoice }` |
| POST | `/institutes/{id}/invoices/{invoiceId}/payments` | Owner, staff. Record an offline payment (body below; header `Idempotency-Key` recommended) → `201 { payment, invoice, creditPaise, replayed: false }`. Amount above the remaining due is kept as guardian credit. Same `Idempotency-Key` again → `200` with the first payment and `replayed: true` (nothing recorded twice). `409` if the invoice is paid, waived or cancelled; `422` for a future `paidAt` (> 5 min) or `method: upi_link` |
| POST | `/institutes/{id}/payments/{paymentId}/void` | `{ reason }` — owner only, offline payments only → `200 { payment, invoices }`. Reopens the invoice(s) (waived/cancelled ones stay so). `409 CONFLICT` if already voided or if `method = upi_link` (refund via provider instead) |
| POST | `/institutes/{id}/invoices/{invoiceId}/remind` | Owner, staff. `{ force?: boolean }` → `202 { scheduledFor }` (queued; the worker sends it). Refused with `409 ALREADY_REMINDED_TODAY` if the guardian already got a fee reminder today (automatic or manual); `force` (owner only, else `403`) allows one extra per day. Quiet hours always apply (`scheduledFor` = 08:00 institute time). `409 NOTHING_DUE` if the invoice is not open; `402 FEATURE_NOT_IN_PLAN` on Free. The text covers ALL the guardian's open dues and is decided at send time |
| POST | `/institutes/{id}/invoices/{invoiceId}/waive` | Owner. `{ reason }` → `200 { invoice }`. Only open invoices (`due`, `partially_paid`); otherwise `409` |
| POST | `/institutes/{id}/invoices/{invoiceId}/cancel` | Owner. `{ reason }` → `200 { invoice }`. Only `due` invoices with nothing paid (part-paid: waive the rest instead); otherwise `409`. A concurrent change (e.g. a payment) → `409`, reload |
| POST | `/institutes/{id}/invoices/{invoiceId}/share-link` | Mints a guardian pay-page token for this invoice's guardian → `{ url, whatsappText }` (Free plan manual share). POST because it creates a token |
| GET | `/institutes/{id}/payments?from&to&method&status&limit` | Owner, staff. Collections list, newest first. `from`/`to` are institute-local days (inclusive); `status=active` by default |
| GET | `/institutes/{id}/payments/{paymentId}` | Owner, staff → `200 { payment, allocations: [{ invoiceId, amountPaise }], creditPaise }` |

Invoice object:
```json
{ "id": "…", "number": "INV-000001", "studentId": "…", "enrollmentId": "…", "batchId": "…", "kind": "cycle", "description": "Class 9 Science · Oct 2026", "periodStart": "2026-10-05", "periodEnd": "2026-11-04", "amountPaise": 120000, "discountPaise": 0, "netPaise": 120000, "paidPaise": 0, "remainingPaise": 120000, "dueDate": "2026-10-11", "status": "due", "closeReason": null }
```
- `kind`: `cycle` (billing run), `one_time` (at enrollment), `manual`. Numbers are per institute and never reused or skipped.
- Amounts are snapshots: later fee changes never rewrite an invoice. No invoice is ever created with a net of ₹0.
- **Billing run** (worker, every 15 min): bills each institute's current period once (`invoice_runs`), catching up after an outage. Monthly, quarterly, half-yearly and yearly enrollments are billed in their due months; students who left and archived batches are skipped.

Dashboard response:
```json
{
  "month": "2026-10",
  "collectedPaise": 4250000,
  "pendingPaise": 1800000,
  "overdueCount": 12,
  "byMethod": { "upi_link": 3100000, "cash": 1150000 },
  "topOverdue": [
    { "studentId": "...", "name": "Aarav Sharma", "guardianPhone": "+9198XXXXX210", "overduePaise": 300000, "daysOverdue": 14 }   // days since the OLDEST overdue due date
  ]
}
```

Record payment (`method`: `cash` \| `bank` \| `other`; `paidAt` ISO 8601 with a zone, default now; `note` optional):
```json
{ "amountPaise": 150000, "method": "cash", "paidAt": "2026-10-18T09:00:00Z", "note": "Paid at center" }
```
Payment object: `{ id, guardianPhone, amountPaise, method, status, paidAt, note, voidedAt, voidReason }`. Teachers get `403` on every fees endpoint.

## 9. Tests & results

Every member reads; **owner and teacher** write (staff `403`). Writing (create, edit, marks, send) needs the plan's `result_cards` feature (Pro, Academy, trial) → `402 FEATURE_NOT_IN_PLAN` otherwise. Reading and deleting work on any plan, so results stay visible after a downgrade.

| Method | Path |
|---|---|
| GET | `/institutes/{id}/batches/{batchId}/tests?limit=1–100 (50)` → `{ tests: [{ ...test, scored, absent }] }`, newest test date first |
| POST | `/institutes/{id}/batches/{batchId}/tests` — `{ name, date, maxMarks }` → `201 { test }`. Archived batch → `409` |
| GET | `/institutes/{id}/tests/{testId}` — the marks sheet → `{ test, students: [{ studentId, name, marks, isAbsent, entered }], stats: { students, scored, absent, average, highest, lowest } }`. Students = enrolled in the batch **on the test date**, plus anyone already scored; sorted by name |
| PATCH | `/institutes/{id}/tests/{testId}` — any of `{ name, date, maxMarks }` → `{ test }`. `maxMarks` below a mark already given → `409` (`details.highestMarks`) |
| DELETE | `/institutes/{id}/tests/{testId}` → `204`. Deletes its marks; queued result cards are then skipped |
| PUT | `/institutes/{id}/tests/{testId}/scores` — `{ scores: [{ studentId, marks } \| { studentId, isAbsent: true }] }` (1–500) → the marks sheet. Upsert: students not sent keep their marks. Marks 0..`maxMarks`, at most 2 decimals; otherwise `422` with `details.studentIds`; a student not in the batch on the test date → `422` |
| POST | `/institutes/{id}/tests/{testId}/send-results` → `{ queued, alreadySent, skipped, resultsSentAt }` |
| GET | `/institutes/{id}/students/{studentId}/tests?limit` → `{ results: [{ test, marks, isAbsent }] }`, newest first |

Test object: `{ id, batchId, name, date, maxMarks, createdBy, resultsSentAt, createdAt }`. `name` 1–80 chars (spaces tidied); `maxMarks` > 0 and ≤ 1000, at most 2 decimals (half marks are fine: `17.5`).

**Send results:** one `result_card` WhatsApp per student **with marks** to their guardian (absent, not yet marked, left, or erased students get none: `skipped`). A student's card is queued at most once per test, so a second tap sends only students marked since (`alreadySent` counts the rest). `409` if no marks are entered yet or the test date is in the future. Consent, quiet hours and quota are checked when the worker sends; the card shows the marks **as they are at send time** (a corrected typo goes out corrected); a deleted test or a mark changed to absent → skipped `stale`. Unsent cards expire after 3 days. The "View details" link arrives with the public result page.

## 10. Notices

Every member may send (teachers too). The plan must include automatic messages (`402` on Free).

| Method | Path |
|---|---|
| POST | `/institutes/{id}/notices/preview` — same body as sending → `{ recipients, messagesNeeded, quotaRemaining }`. Nothing is sent |
| POST | `/institutes/{id}/notices` — sends → `201 { notice, queued }`. Max 2 notices/day during the trial, 5 on paid plans (institute day) → `429 DAILY_LIMIT_REACHED` (`details.limit`) |
| GET | `/institutes/{id}/notices?limit` → `{ notices: [{ id, kind, batchIds, content, recipients, sentBy, day, createdAt }] }`, newest first |

Body — one of three kinds (KB §4 templates; offer the structured ones first, Meta is likelier to reject free text):
```json
{ "kind": "general", "batchIds": ["…"], "text": "Exam on Monday. Bring pens." }
{ "kind": "holiday", "batchIds": ["…"], "date": "2026-10-24", "resumeDate": "2026-10-27", "reason": "Diwali" }
{ "kind": "schedule_change", "batchIds": ["…"], "date": "2026-10-21", "time": "18:30" }
```
- `general.text`: 1–500 chars after cleaning (newlines → " · ", runs of spaces/tabs → one space); **no links**. `reason`: 1–80 chars, no links.
- Dates can't be in the past; `resumeDate` must be after `date`; `schedule_change` takes exactly one batch.
- Recipients: guardians of active students enrolled in the batches today, **one message per guardian** (siblings in several batches get one). Consent, quiet hours and quota are checked when the worker sends; unsent notices expire 21:00 the next day.

## 11. Messaging

| Method | Path |
|---|---|
| GET | `/institutes/{id}/messages?status&category&limit=1–100 (50)&cursor` — owner, staff. The outbox log, newest first → `{ messages: [{ id, category, template, to (masked), status, skipReason, errorCode, attempts, scheduledFor, createdAt }], nextCursor }` |
| GET | `/institutes/{id}/messages/usage` — owner, staff → `{ month, used, limit, todayUsed, todayLimit, trialTotalLimit }`. `limit` = the plan's monthly quota (0 on Free); `todayLimit` is set during the trial and an institute's first 7 days (100), else `null`; `trialTotalLimit` = 200 during the trial |
| GET | `/institutes/{id}/replies?limit&cursor` — guardians' WhatsApp replies routed to this institute ("Parent replies") |
| POST | `/institutes/{id}/guardians/{phone}/opt-in` — owner, staff. Record consent `{ source: "verbal" \| "form" \| "whatsapp" }` → `204`. `phone`: any Indian format (`9812345678` or URL-encoded `%2B919812345678`); bad → `422` |
| POST | `/institutes/{id}/guardians/{phone}/opt-out` — owner, staff. Same body → `204`. The guardian gets no automatic messages from this institute |

Only guardians with consent (`opted_in`) are ever messaged; the check happens at send time.

**Fee reminders** (automatic, worker): on the institute's `reminderOffsets` (setting; default `[3, 0, -3, -7]` = 3 days before the due date, on it, 3 and 7 days after; `[]` = off), at most one per guardian per day, siblings combined (`fee_reminder` for one child, `fee_reminder_multi` for several, chosen at send time from what is due THEN; skipped if nothing is due). Students who left get none. Plan needs automatic messages. The "Pay now" button's link token arrives with the pay page.

**Limits** (checked right before sending; over → message `skipped`, `skip_reason = over_quota`): the plan's monthly quota; during the trial 100/day and 200 in total; any institute's first 7 days 100/day. A failed send doesn't count. Consent is also recorded by `guardianConsent: true` on `POST /students` and `POST /students/bulk` (the "Guardian agreed to receive updates on WhatsApp" checkbox).

## 11a. Audit log

| Method | Path |
|---|---|
| GET | `/institutes/{id}/audit-log?limit&cursor` — owner → `{ entries: [{ id, action, actorUserId, entityType, entityId, before, after, createdAt }], nextCursor }`, newest first. Actions: `payment.void`, `invoice.waive`, `invoice.cancel`, `member.add`, `member.remove`, `institute.settings`, `student.erase`. Entries hold statuses, amounts and ids only — never names or phones |

## 12. Subscription

| Method | Path |
|---|---|
| GET | `/plans` — public (no login) → `{ plans: [{ id, maxActiveStudents, maxMembers, monthlyMessages, monthlyPricePaise, yearlyPricePaise, features }], trial: { plan, days, messageTotal } }` |
| GET | `/institutes/{id}/subscription` — owner → `{ plan (applies now), status, currentPeriodEnd, graceUntil, limits: { maxActiveStudents, maxMembers, monthlyMessages, features }, usage: { activeStudents, members, messages } }` |
| POST | `/institutes/{id}/subscription/checkout` — `{ plan, interval }` → `{ checkoutUrl }` or store-purchase params (depends on final billing decision) |
| POST | `/institutes/{id}/subscription/cancel` — cancel at period end |

## 13. Public (guardian) endpoints — no auth, token-based

| Method | Path | Description |
|---|---|---|
| GET | `/public/pay/{token}` | **Read-only.** All open dues of this guardian at this institute (live): institute name, per invoice student first name + description/period + remaining, total. No side effects — safe for link previews and prefetch |
| POST | `/public/pay/{token}/checkout` | Creates or reuses a payment link for the **current** total → `{ payUrl }`. Links expire in 24 h; a link whose amounts no longer match is cancelled and replaced. `409 NOTHING_DUE` if everything is already paid |
| GET | `/public/receipts/{token}` | Receipt data (shows "cancelled" if the payment was voided/refunded) |
| GET | `/public/results/{token}` | Result card data |

Tokens: 128-bit random, only the hash is stored, minted by the worker at send time (never stored raw). Pay tokens are per guardian and expire after 30 days; receipt/result tokens after 180 days. Expired or unknown token → `404`.

Responses never include full guardian phone, students of other guardians, or institute internals. Rate limited per IP.

## 14. Webhooks (provider → API)

| Method | Path | Verification |
|---|---|---|
| POST | `/webhooks/razorpay` | HMAC-SHA256 of raw body with webhook secret (`X-Razorpay-Signature`) |
| GET | `/webhooks/whatsapp` | Meta verify-token handshake |
| POST | `/webhooks/whatsapp` | `X-Hub-Signature-256` with app secret |
| POST | `/webhooks/billing` | Store/RevenueCat or Razorpay subscriptions (TBD) |

Behavior: verify → insert into `webhook_events` (unique `(provider, event_id)`) → enqueue → `200` fast. Duplicates return `200` without reprocessing.

WhatsApp inbound `STOP` / `UNSUBSCRIBE` replies → **global** opt-out from all institutes (one shared sender number); `START` resumes. Other replies get one auto-reply per 24 h and appear under `/replies` for the resolved institute. See LLD §6.8.

Razorpay account/KYC webhooks (linked account activated/rejected) update `institutes.payout_status`.

## 15. Health

`GET /health` (liveness) · `GET /ready` (DB + Redis reachable)
