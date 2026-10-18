# REQUIREMENTS.md

> Product working name: **TuitionMitra** (final name undecided — find/replace when chosen).
> Status: v0.1 draft · Owner: Sumit

## 1. Product summary

A mobile app for **small offline tuition centers, home tutors, and non-academic academies** (dance, music, sports, chess, abacus, art, spoken English) in India that puts **fee collection and parent updates on autopilot**.

**Core promise:** "Collect pending fees and update parents automatically on WhatsApp — parents don't need to install anything."

### 1.1 Target customers (ICP)

| Segment | Size | Typical pain |
|---|---|---|
| Small tuition centers | 1–3 teachers, 20–200 students | Fees pending, notebook registers, WhatsApp group chaos |
| Home tutors | 1 teacher, 10–40 students | Awkward fee follow-ups, no records |
| Academies (dance, music, sports, etc.) | 1–5 coaches, 30–300 students | Same problems; ignored by edtech platforms |

**Not targeted:** large institutes, schools, online course sellers, content/video platforms.

### 1.2 Personas

- **Owner (primary user):** runs the center, collects fees, low patience for complex software, uses an Android phone (often mid/low-end), comfortable with WhatsApp and UPI. Hindi or English.
- **Teacher/Staff:** takes attendance, enters marks. Limited permissions.
- **Guardian (parent):** never installs the app. Receives WhatsApp messages, opens web links to pay or view reports.

## 2. Features

### 2.1 MVP (v1.0)

| ID | Feature | Description |
|---|---|---|
| F-01 | Phone OTP login | Sign up/in with mobile number. No email, no password. |
| F-02 | Institute setup | Name, type (tuition/academy), city, logo (optional). Under 2 minutes. |
| F-03 | Batches | Create batches with name, subject/activity, days, time, default fee, fee cycle. |
| F-04 | Students | Add student + guardian name/phone. Pick a guardian from contacts via the system contact picker (no contacts permission), or bulk add from a pasted list. |
| F-05 | Enrollment | Assign students to one or more batches; per-student fee override/discount. |
| F-06 | Attendance | One-tap present/absent per batch per day. Works offline, syncs later. |
| F-07 | Absence alerts | Optional automatic WhatsApp message to guardian when a student is absent. |
| F-08 | Fee invoices | Auto-generate dues per cycle (monthly/quarterly/one-time). |
| F-09 | UPI payment links | Each guardian gets one pay page covering all their open dues (siblings included); paying there uses a Razorpay UPI link. Paid status updates automatically. |
| F-10 | Fee reminders | Automatic WhatsApp reminders on a schedule; manual "remind now". |
| F-11 | Record offline payment | Mark cash/bank payments manually; partial payments supported. |
| F-12 | Receipts | Auto-send receipt link to guardian on every payment. |
| F-13 | Fee dashboard | Collected this month, pending, overdue list, who to call. |
| F-14 | Tests & marks | Create test, enter marks, send result card to guardians. *(Proposal: move F-14/F-15 to v1.1 — KNOWLEDGE_BASE §8 P-4)* |
| F-15 | Notices | Broadcast a notice to one/many batches via WhatsApp. |
| F-16 | Subscription & plans | Free tier, paid plans, trial, plan limits enforced. |
| F-17 | Language | English + Hindi UI from day one. |
| F-18 | Help | In-app WhatsApp support button, 60-sec onboarding video. |

### 2.2 v2 (after product–market fit signals)

| ID | Feature |
|---|---|
| F-20 | Monthly progress report PDF per student |
| F-21 | Per-batch access (a teacher sees only assigned batches). Multiple members with institute-wide roles are already in MVP, limited by plan |
| F-22 | Lead tracker (inquiries, demo class, follow-up) |
| F-23 | Expense tracking (rent, salaries) → profit view |
| F-24 | Public institute page (timings, fees, inquiry button) |
| F-25 | Multi-branch support |
| F-26 | Regional languages (Kannada, Tamil, Marathi, Bengali, Telugu) |
| F-27 | Teacher salary / revenue share tracking |
| F-28 | Referral program (free month per referred institute) |
| F-29 | Free web tools: receipt generator, report card maker, timetable maker (lead magnets) |

### 2.3 Explicitly out of scope

Video hosting, live classes, course selling, content library, student-facing app, school ERP features (transport, hostel, library).

## 3. Subscription plans

Plans, prices, limits, and plan rules (trial, grace, downgrade, message packs) are defined **only** in `KNOWLEDGE_BASE.md` → §3 Plans, and mirrored in code by `packages/shared/src/plans.ts`. Don't restate numbers here.

Summary: four tiers — Free (manual sharing, no automatic WhatsApp), Starter (automation), Pro (+ tests/results, team members), Academy (unlimited, multi-branch in v2). Plan limits live in config (`entitlements`), not hard-coded in features.

> ⚠️ Before launch, verify current Google Play and Apple App Store rules for selling subscriptions inside the app in India (store billing vs. alternative/user-choice billing vs. web checkout). See KNOWLEDGE_BASE.md → Open questions.

## 4. Functional requirements

### 4.1 Auth & accounts
- FR-1.1 User signs in with phone number + 6-digit OTP. OTP expires in 5 minutes; max 5 attempts; max 3 OTP requests per 15 minutes per number. Only Indian mobile numbers (+91) can sign in. A single configured reviewer number with a fixed OTP exists for app-store review.
- FR-1.2 Sessions use a short-lived access token and a rotating refresh token. User stays logged in for 90 days of activity.
- FR-1.3 A user can belong to multiple institutes and switch between them.
- FR-1.4 Roles (institute-wide in MVP; per-batch scoping is v2, F-21):
  - `owner` — everything: institute settings, plan, members, fees, waive/cancel invoices, void payments.
  - `teacher` — teaches batches: attendance, tests & marks, notices; can view batches and students; **no access to fees**.
  - `staff` — front desk / admin: manage batches and students, attendance, notices; **view fees and record offline payments**; cannot waive, cancel, void, or change fee settings.
  - Full matrix: API_DOCS.md → Roles.
- FR-1.5 A user can delete their account from the app and from a public web page (Google Play requirement). A sole owner must delete or hand over the institute first.

### 4.2 Batches & students
- FR-2.1 Owner can create, edit, archive batches. Archived batches are hidden but keep history.
- FR-2.2 Owner can add students one by one or in bulk (paste "Name, Guardian phone" lines, or pick one contact at a time via the system picker — the app never requests the contacts permission). Invalid rows are shown, not silently dropped.
- FR-2.3 Phone numbers are normalized to E.164 (`+91XXXXXXXXXX`). Duplicate guardian phone is allowed (siblings).
- FR-2.4 A student can be enrolled in multiple batches; each enrollment has its own fee (default = batch fee, overridable).
- FR-2.5 Marking a student "left" stops future invoices and reminders but keeps history.

### 4.3 Attendance
- FR-3.1 One attendance session per batch per date. Default status for all = present; teacher taps absentees.
- FR-3.2 Attendance can be taken offline and is synced when online; conflicts resolve per student record by whichever sync reached the server last (server time, not the phone's clock), with audit.
- FR-3.3 If absence alerts are enabled, one WhatsApp message per absent student per session, sent after the session is submitted (not on every tap). If attendance syncs too late (after 10:00 the day after the class), no alert is sent and the app says so.
- FR-3.4 Attendance can be edited up to 7 days back (configurable); edits after alerts are sent do not resend alerts.

### 4.4 Fees & payments
- FR-4.1 Invoices are generated automatically per enrollment fee cycle on the institute's billing day (default: 1st of month; due date default: 7th). The fee cycle is set per enrollment (defaults to the batch's). If generation is missed on the billing day, it runs on the next day it can. `one_time` fees are invoiced once, at enrollment. Invoices with a net amount of ₹0 are not created.
- FR-4.2 Invoice amounts are stored in **paise (integer)**. Discounts are stored separately.
- FR-4.3 Each guardian has one pay page showing all their open dues at the institute; paying there creates a UPI payment link for the current total. When the provider confirms payment via webhook, the payment is applied to the oldest dues first and the invoices move to `paid` or `partially_paid` within 1 minute. Any amount that can't be applied is kept as guardian credit.
- FR-4.4 Owners can record offline payments (cash/bank/other) with optional note; partial payments allowed. Owners can void an offline payment entered by mistake (reason required, audited); the invoice reopens and reminders resume. Online payments are reversed only via provider refund.
- FR-4.4a When an invoice's remaining amount changes, any outstanding payment link with the old amount is cancelled so a guardian can't pay twice.
- FR-4.5 Owners can waive or cancel an invoice with a reason.
- FR-4.6 A receipt link is sent to the guardian after each successful payment (if messaging is enabled for the plan).
- FR-4.7 Fee dashboard shows: collected this month, total pending, overdue count, list sorted by amount overdue.
- FR-4.8 Money from guardians goes **directly to the institute's own account** (via the payment provider's linked/sub-merchant account). The platform never holds institute money in MVP. (See KNOWLEDGE_BASE → Payments.)

### 4.5 Reminders & messaging
- FR-5.1 Default fee reminder schedule: 3 days before due, on due date, 3 days after, 7 days after. Owner can turn off or change offsets.
- FR-5.2 Max one fee reminder per guardian per day (multiple children's dues combined into one message).
- FR-5.3 No automatic messages between 21:00 and 08:00 IST (quiet hours); queued messages wait.
- FR-5.4 All outgoing messages go through the message outbox with status tracking (queued → sent → delivered → read / failed). Message content is checked against current data right before sending: a fee reminder is skipped if everything was paid meanwhile, and its amount reflects payments made while it waited.
- FR-5.5 If WhatsApp fails or the guardian hasn't opted in, fall back to SMS (v1.1) or show "send manually" to the owner.
- FR-5.6 Message usage per institute per month is counted and enforced against plan limits.
- FR-5.7 Guardians can reply "STOP" to opt out of automatic messages from all institutes on our number (payment receipts excepted) and "START" to resume; both are confirmed by reply.
- FR-5.8 Other guardian replies get one auto-reply per day pointing them to the institute, and are shown to the owner as "Parent replies".
- FR-5.9 Automatic messaging is limited per institute per day during the first 7 days and the trial, and is paused automatically for an institute whose guardians opt out or block at a high rate.

### 4.6 Tests & notices
- FR-6.1 Owner/teacher can create a test (name, date, max marks) for a batch and enter marks; absent students are marked separately.
- FR-6.2 Result card sent as a web link per student.
- FR-6.3 Notices can be sent to selected batches; message count shown before sending. Notices are 1–500 characters, contain no third-party links, and are limited to 2 per day (5 on paid plans).

### 4.7 Subscription
- FR-7.1 Plan limits (students, staff, messages, features) are enforced server-side.
- FR-7.2 Owner sees current plan, usage, and renewal date.
- FR-7.3 Payment success activates the plan immediately; failure triggers grace period.

### 4.7a Payouts
- FR-7.4 Owner can start payment-provider onboarding (KYC) from the app and see its status.
- FR-7.5 Until payouts are active, owner can set the institute's UPI ID; the pay page then shows a UPI QR / app button for that ID, and payments are recorded manually.

### 4.7b Data rights
- FR-7.6 Owner can export all institute data (CSV ZIP).
- FR-7.7 Owner can delete the institute (fresh OTP required); it can be undone for 30 days, then all its data is purged.
- FR-7.8 Owner can erase one student's personal data on a guardian's request; amounts stay for the institute's books.

### 4.8 Public guardian pages (web)
- FR-8.1 Receipt, pay, and result pages are accessed via unguessable random tokens (stored hashed); no login. Opening a page never changes data; a payment link is created only when the guardian taps "Pay".
- FR-8.2 Pages load under 2 seconds on 3G and work on any mobile browser.
- FR-8.3 Tokens expire (pay pages: 30 days, and show "nothing due" once everything is paid; receipts/results: 180 days). Provider payment links expire after 24 hours.

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Performance | API p95 < 300 ms for reads, < 500 ms for writes (excluding external calls). App cold start < 3 s on a 2 GB RAM Android phone. |
| NFR-2 | App size | Android download < 30 MB. |
| NFR-3 | Network | Usable on slow 3G; attendance fully offline; all screens show cached data when offline. |
| NFR-4 | Availability | 99.5% monthly uptime for API; webhooks must never be lost (store first, process async). |
| NFR-5 | Scalability | Designed for 20,000 institutes, 2M students, 5M messages/month without re-architecture; MVP infra sized for 500 institutes. |
| NFR-6 | Reliability | Every external side effect (message, payment link) is idempotent and retried with backoff; dead-letter queue for failures. |
| NFR-7 | Security | TLS everywhere; JWT access tokens ≤ 15 min; refresh tokens hashed at rest; webhook signatures verified; OWASP ASVS L1 baseline. |
| NFR-8 | Tenant isolation | Every query is scoped by `institute_id`; automated tests verify cross-tenant access is impossible. |
| NFR-9 | Privacy / compliance | Student data includes minors. Follow the DPDP Act and DPDP Rules, 2025 (we act as the institute's Data Processor; see KNOWLEDGE_BASE open question 3). Store data in India (AWS ap-south-1) — a product choice, see open question 11. Collect guardian consent for messaging; no analytics/tracking on guardian pages; support data export and deletion per institute. |
| NFR-10 | Data durability | Daily automated backups + point-in-time recovery (7 days min); restore tested monthly. |
| NFR-11 | Observability | Structured logs, error tracking, request tracing, business metrics (messages sent, payments, active institutes). Alerts on webhook failures and queue backlog. |
| NFR-12 | Localization | All UI strings externalized; English + Hindi at launch; numbers in Indian format (₹1,23,456). Dates shown in IST. |
| NFR-13 | Accessibility | Minimum tap target 44 px, readable font sizes, works with large system font. |
| NFR-14 | Cost | Infra + messaging cost per paying institute < 25% of its plan price. ⚠️ Current quotas break this at full usage — see KNOWLEDGE_BASE §3 cost check and open question 9. |
| NFR-15 | Maintainability | TypeScript strict mode, shared validation schemas, ≥ 70% coverage on domain/services, CI blocks merge on failing tests/lint. |
| NFR-16 | Auditability | Fee changes, payments, waivers, and role changes are written to an audit log. |

## 6. Key user stories (MVP acceptance)

1. *As an owner, I can sign up and add my first batch and 20 students in under 5 minutes.*
2. *As a teacher, I can take attendance for a 30-student batch in under 30 seconds, even without internet.*
3. *As an owner, I see exactly who hasn't paid this month and the total amount pending.*
4. *As a guardian, I get a WhatsApp reminder with a link, pay via UPI, and instantly get a receipt.*
5. *As an owner, when a parent pays online, the app shows it as paid without me doing anything.*
6. *As an owner, I can send test results to all parents of a batch with one tap.*

## 7. Success metrics

- Activation: % of new institutes that add ≥ 10 students and generate first invoices within 7 days.
- Core value: ₹ collected through payment links per institute per month.
- Retention: weekly active institutes (attendance taken ≥ 3 days/week).
- Conversion: trial → paid %.
- Cost: messaging cost per institute vs. plan price.
