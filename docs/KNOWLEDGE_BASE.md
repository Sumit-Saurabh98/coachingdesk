# KNOWLEDGE_BASE.md

The "why" behind the product. Read this before changing business logic.

## 1. Market context

- Large coaching institutes already use platforms like Classplus and Teachmint. Those products focus on **taking teaching online**: branded apps, content, live classes, course selling.
- Small offline tuition centers, home tutors, and non-academic academies mostly run on **a notebook + WhatsApp groups + UPI screenshots**. That is our real competitor: habit, not software.
- Our wedge: **fees and parent communication**, with **zero setup for parents** (WhatsApp + web links, no app install).
- Pitch: *"You'll recover more pending fees in month one than the app costs for a year."*

## 2. Glossary

| Term | Meaning |
|---|---|
| Institute | A tenant: tuition center, home tutor, or academy. |
| Owner | User who created the institute; full control incl. money and plan. |
| Batch | A group taught together at fixed days/time (e.g. "Class 10 Maths – Evening", "Kathak Beginners Sat"). Indian coaching thinks in batches, not "courses". |
| Student | A learner. Often a minor. Belongs to one institute. |
| Guardian | Parent/relative who pays and receives messages. Identified by phone. One guardian may have several students (siblings). |
| Enrollment | Student ↔ batch link with its own fee. |
| Fee cycle | `monthly` (most common), `quarterly`, `half_yearly`, `yearly` (e.g. academies billing per term/session), `one_time` (e.g. crash course), `none` (free batch). Set per enrollment; the batch only provides the default. |
| Pay page | *Not in the MVP (decision #51).* Was: one web page per guardian listing their open dues, linked from reminders. |
| Credit | Money received that couldn't be applied to an open due (overpayment, or a late payment on an already-paid invoice). |
| Billing day | Day of month when invoices are generated (default 1st). |
| Invoice / Due | Amount a student owes for a period. UI calls it "Fee due", not "invoice". |
| Absence alert | WhatsApp to guardian when a student is marked absent. |
| Outbox | Table of all outgoing messages; the only way messages are sent. |
| Template | Pre-approved WhatsApp message format required for business-initiated messages. |
| Entitlements | What an institute's plan allows (limits + features). |

## 3. Business rules (source of truth)

### Fees
- Money stored in paise. Display with Indian grouping: ₹1,23,456.
- Due date default = billing day + 6 days (i.e. 7th).
- Mid-month joiners: MVP does **not prorate**. Owner chooses "bill now" (full amount) or "start next cycle".
- `one_time` fees are invoiced once, when the student is enrolled. Multi-month cycles repeat from the first billed period: quarterly every 3 months, half-yearly every 6, yearly every 12.
- Never create a ₹0 invoice (fee fully discounted or fee = 0) — it would look like a due to the guardian.
- If invoice generation misses the billing day (outage), it catches up the next day; the period is never skipped.
- Partial payments allowed. A payment covering several dues is applied **oldest due date first**. Anything left over is recorded as credit (applied manually in MVP).
- An offline payment entered by mistake can be **voided** by the owner (reason required, audited). The invoice reopens and reminders resume. Online payments can't be voided — they're reversed only by a refund through the provider.
- *(Not in the MVP, decision #51: no payment links for parents.)* If links return: a link must never ask for an outdated amount (cancel outstanding links when a due changes; expire after 24 h).
- Waive/cancel require a reason; both are audited.
- A student marked "left" → no new invoices; existing dues remain until owner cancels.

### Reminders
- Default offsets: 3 days before, on due date, 3 and 7 days after. After that, stop automatic reminders (owner can still remind manually).
- Max **1 fee reminder per guardian per day**; siblings' dues combined in one message. When any one due hits a reminder offset, the message covers all of that guardian's open dues.
- Reminder content (names, total) is computed at **send** time, not when it's scheduled. If the guardian paid while the message waited (e.g. quiet hours), it's skipped.
- Quiet hours 21:00–08:00 IST: never send automatic messages.
- Tone: polite, respectful, never threatening. Hindi + English templates.

### Attendance
- Default = everyone present; teacher marks absentees (fastest flow).
- Absence alert sent once per session, after submission. Not sent at all if attendance syncs after 10:00 the day after the class — a stale "absent" message confuses parents.
- Edits allowed up to 7 days back.
- When two phones edit the same session, the sync that reached the server last wins per student. Phone clocks are not trusted.

### Messaging & consent
- WhatsApp business-initiated messages need **approved templates**; free text only allowed inside an active customer-service window.
- Guardians must have **opted in**. Institutes confirm consent when adding students (checkbox: "Guardian agreed to receive updates on WhatsApp"), including bulk import. Store source + timestamp.
- Consent status `unknown` means **do not send** — only `opted_in` guardians get automatic messages. The owner sees "consent missing" and can share manually.
- All institutes share **one** sender number (ARCHITECTURE §13). So a STOP reply opts the guardian out of automatic messages from **every** institute, immediately; payment receipts are still sent. START resumes.
- Guardian replies other than STOP/START get one auto-reply per 24 h ("this number only sends automatic updates for {institute}; contact them on {phone}") and are shown to the owner as "Parent replies". We never hold conversations on the institute's behalf.
- Protect the shared number: new and trial institutes have daily caps; notices are limited; an institute with a high STOP/block rate is paused automatically (LLD §6.8).
- Template parameters can't contain newlines, tabs, or more than 4 consecutive spaces — sanitise all free text (notices, names) before sending.
- Template categories matter for pricing (e.g. utility vs. marketing). Fee reminders, receipts, absence alerts, and results should be utility. Never put promotional content in utility templates — Meta can re-categorise a template to marketing, which costs several times more.
- Meta charges **per delivered template message** (pricing model since 1 July 2025; the old per-conversation model is gone). Utility templates sent while the guardian's 24-hour customer-service window is open are free. Rates vary by category and country — check Meta's current India rate card; don't hard-code a price.

### Payments
- Guardian money should settle to the **institute's own account**, not the platform's, using the provider's linked/sub-merchant accounts. This avoids the platform acting as a payment intermediary holding funds.
- *(Not in the MVP, decision #51.)* Parents pay the institute directly: cash, the institute's own UPI ID, or a bank transfer; the owner records it (method `upi`/`cash`/`bank`/`other`). Earlier plan, kept for reference: institute onboarding to payouts (KYC) through the provider's flow; until it's active, the owner can set the institute's own UPI ID: the pay page shows a UPI QR / "Pay with UPI app" button for it, and the owner records the payment manually (no automatic reconciliation). With neither set, the pay page shows the dues and "please pay at the center".
- Gateway fees: configurable — absorbed by institute (default) or added as convenience fee (check provider rules).

### Plans (single source of truth — `packages/shared/src/plans.ts` must match this table)
| Plan | Active students | Members besides owner | Messages/mo | Price | Included |
|---|---|---|---|---|---|
| Free | 25 | 0 | 0 automatic | ₹0 | Batches, attendance, manual fee tracking and receipts. "WhatsApp" opens WhatsApp manually. |
| Starter | 100 | 0 | 1,000 | ₹299/mo · ₹2,999/yr | Free + automatic reminders, absence alerts, receipts, notices |
| Pro | 300 | 5 | 3,000 | ₹699/mo · ₹6,999/yr | Starter + tests/result cards, team members, progress reports (v2) |
| Academy | ∞ | ∞ | 8,000 | ₹1,499/mo · ₹14,999/yr | Pro + multi-branch (v2), priority support |

- "Active students" = `status = 'active'`; students marked left are not counted.
- **Trial:** 30 days of Pro on signup, then Free unless they subscribe. Automatic messages during the trial are capped at **200 total and 100/day** (not the Pro quota) — the trial must not be usable as a free bulk-messaging channel.
- **New institutes:** first 7 days max 100 automatic messages/day, any plan.
- **Notices:** max 2 per institute per day (5 on paid plans), 1–500 chars, no third-party links.
- **Grace:** 7 days after a failed renewal before downgrade.
- **Downgrade:** data is never deleted; over-limit students become read-only until upgrade or archive.
- **Message packs:** extra 1,000 messages for ₹149 (must stay above provider cost — see cost check below).
- Whether prices include 18% GST is not yet decided (open question 8).

**Cost check (NFR-14: infra + messaging < 25% of plan price)** — rough, recompute with Meta's current India rate card:
| Plan | Price (pre-GST, if GST-inclusive) | Store fee if billed via Play (~15%) | Messages at full quota × ~₹0.12–0.20 utility | Messaging as % of net |
|---|---|---|---|---|
| Starter ₹299 | ≈ ₹253 | ≈ ₹38 → net ≈ ₹215 | ≈ ₹120–200 | **≈ 55–95%** ❌ |
| Pro ₹699 | ≈ ₹592 | ≈ ₹89 → net ≈ ₹503 | ≈ ₹360–600 | **≈ 70–120%** ❌ |
| Academy ₹1,499 | ≈ ₹1,270 | ≈ ₹190 → net ≈ ₹1,080 | ≈ ₹960–1,600 | **≈ 90–150%** ❌ |

At full quota every paid plan breaks NFR-14; message packs at ₹149/1,000 are near or below cost. Typical usage will be well under quota, but the numbers can't be left like this. Open question 9 must be decided before launch.

## 4. WhatsApp templates (draft list)

| Name | Category | Example (EN) | Button |
|---|---|---|---|
| `fee_reminder` | utility | "Hello {{guardian}}, {{student}}'s fee of ₹{{amount}} at {{institute}} is due on {{date}}." | "Pay now" → `https://<domain>/p/{{token}}` |
| `fee_reminder_multi` | utility | "Hello {{guardian}}, fees of ₹{{total}} are due for {{students}} at {{institute}}." | "Pay now" → `https://<domain>/p/{{token}}` |
| `payment_receipt` | utility | "Received ₹{{amount}} for {{students}} at {{institute}}. Thank you!" | "View receipt" → `https://<domain>/r/{{token}}` |
| `absence_alert` | utility | "{{student}} was absent on {{date}} from {{batch}} at {{institute}}." | — |
| `result_card` | utility | "{{student}}'s result for {{test}} at {{institute}}: {{marks}}/{{max}}." | "View details" → `https://<domain>/t/{{token}}` |
| `notice` | utility | "Notice from {{institute}}: {{text}}" (1–500 chars, sanitised, no promos) | — |
| `notice_holiday` | utility | "{{institute}} will be closed on {{date}} ({{reason}}). Classes resume on {{resume_date}}." | — |
| `notice_schedule_change` | utility | "{{batch}} at {{institute}} will be held at {{time}} on {{date}} instead of the usual time." | — |
| `otp` | authentication | "{{code}} is your login code." | — |

The free-text `notice` template is the one most likely to be rejected or re-categorised as marketing by Meta, since it can carry any text. Submit the structured `notice_holiday` / `notice_schedule_change` templates too. The app offers those first ("Holiday", "Timing change", "Other"), so most notices still work if `notice` is rejected.

Free-form replies (STOP/START confirmations, the auto-reply) need no template: they're sent inside the guardian's 24 h customer-service window opened by their message.

Links go in **URL buttons with a dynamic suffix**, not in the body text: the domain is fixed at template approval and only the token varies. Tokens are minted by the send worker at send time and never stored raw.

Each needs Hindi version. Template approval takes time — submit early.

## 5. Go-to-market notes (online only)

- Channels: cold calls to Google Maps listings → WhatsApp demo video → video-call setup; Play Store keyword optimization ("tuition fees app", "attendance app for tuition"); Hindi Shorts/Reels for tutors; Facebook/Telegram tutor groups; free web tools as lead magnets; referrals (free month per referral).
- Product implication: **fully self-serve onboarding** — OTP signup, paste/import students, first invoice in < 5 minutes, help button opens WhatsApp chat with founder.
- North-star metric: **₹ collected through the app per institute per month.**

## 6. Decision log (ADR-lite)

| # | Date | Decision | Reason |
|---|---|---|---|
| 1 | 2026-10 | Target small offline centers + academies, not large institutes | Big players cover large institutes; small ones are underserved |
| 2 | 2026-10 | Parents use WhatsApp + web links, no parent app | Removes the biggest adoption barrier |
| 3 | 2026-10 | Modular monolith + worker, TypeScript everywhere | Solo developer speed |
| 4 | 2026-10 | Postgres + BullMQ/Redis | Relational money data; simple reliable jobs |
| 5 | 2026-10 | Outbox pattern for all messages | Reliability, auditing, quota enforcement |
| 6 | 2026-10 | Money settles to institute accounts via provider | Avoid holding customer funds |
| 7 | 2026-10 | Online-only customer acquisition | Founder constraint; drives self-serve UX |
| 8 | 2026-10 | One pay page per guardian (live open dues), not one link per invoice | Sibling reminders need one link; a live page never shows a stale amount |
| 9 | 2026-10 | Public GETs have no side effects; payment links created on checkout POST, expire in 24 h, cancelled when amounts change | Link prefetchers would create links; stale links let guardians pay twice |
| 10 | 2026-10 | Payments split into invoices via `payment_allocations` (oldest due first; leftover = credit) | One UPI payment can cover several dues; enables void/refund cleanly |
| 11 | 2026-10 | Offline payments can be voided (audited); online only via provider refund | Owners mistype cash entries; online money must match the provider |
| 12 | 2026-10 | Fee cycle lives on the enrollment; invoice runs tracked per period with catch-up; ₹0 invoices never created | Students pay on different cycles; outages must not skip a month |
| 13 | 2026-10 | Message content re-validated at send time; guardian link tokens minted at send time and only hashed at rest | Avoid reminders for paid fees; raw tokens in the outbox would defeat hashing |
| 14 | 2026-10 | Fixed role matrix: teacher = teaching only (no fees); staff = front desk (view fees, record offline payments); owner-only for waive/cancel/void/settings | One unambiguous, testable permission model |
| 15 | 2026-10 | Login OTP is the only message sent directly by the API, not via outbox | User waits on screen; outbox adds latency |
| 16 | 2026-10 | MVP hosting: single EC2 + RDS + ElastiCache in ap-south-1; Fargate at Growth stage; Railway/Render dropped | Lower cost; those hosts have no India region |
| 17 | 2026-10 | Plans/prices defined only in KNOWLEDGE_BASE §3 (+ `plans.ts`) | One source of truth |
| 18 | 2026-10 | One shared WhatsApp number in MVP; global STOP opt-out; inbound replies routed + auto-reply; per-institute quality guard and daily caps | One verification/template set to launch; protect the number every tenant depends on |
| 19 | 2026-10 | Trial messaging capped at 200 total / 100 per day; notices limited | Prevent trial signups from being used for spam |
| 20 | 2026-10 | Money as safe-integer `number` in TS (Postgres `bigint`), not JS `BigInt` | `BigInt` breaks JSON and adds friction across Zod/RN; paise fits safely in a double |
| 21 | 2026-10 | Attendance conflicts: last sync received by server wins; alerts expire 10:00 next day | Phone clocks unreliable; stale absence alerts mislead parents |
| 22 | 2026-10 | Data rights in MVP: export, institute deletion (30-day undo then purge), student erasure, account deletion (app + web) | DPDP + Google Play account-deletion policy |
| 23 | 2026-10 | OTP only to +91 numbers; fixed-OTP reviewer number | Block SMS-pumping fraud; app-store review needs a login |
| 24 | 2026-10 | Pay page falls back to the institute's own UPI ID (manual reconciliation) until payouts KYC is active | Tiny tutors may never finish KYC; they still get value |
| 25 | 2026-10 | OOP + SOLID: value objects/entities, services with constructor-injected interfaces, repository interfaces, hand-written composition root | Founder preference and learning goal; clear seams for testing with fakes |
| 26 | 2026-10 | `InstituteRepository.createWithOwner` writes institute + owner membership + initial trial subscription in ONE transaction — the only place one module writes another's table (`subscriptions`); the subscriptions module owns every later change | A half-created institute (no owner / no plan) must be impossible; cross-module 2-phase writes would be far more complex |
| 27 | 2026-10 | Fee cycles add `half_yearly` and `yearly` (6 / 12 months from `cycle_anchor`), alongside monthly, quarterly, one_time, none | Academies, music and sports classes often bill per term or session; same anchor-based billing, so little extra logic |
| 28 | 2026-10 | Plan limits are enforced in the repository: count + insert in one transaction holding a row lock on the institute (`SELECT … FOR UPDATE`). The effective plan is computed from the subscription row's dates (an expired trial is Free immediately, no job needed) | Several API instances run; a read-then-write check lets two requests both take the last slot. Dates-not-status means a late background job can't extend a trial |
| 29 | 2026-10 | Bulk student import: rows validated one by one (bad rows reported, good rows created), but the plan limit is all-or-nothing for the good rows | Owners fix a typo and resend; a half-imported list is harder to reason about than a clear "you can add 5 more" |
| 30 | 2026-10 | Tenant-owned link tables use composite foreign keys `(institute_id, x_id) → x(institute_id, id)` (first: enrollments → students, batches) | The database itself refuses a cross-institute link, whatever the code does — defence in depth for AGENTS rule 1 |
| 31 | 2026-10 | Teachers never receive fee fields: responses go through `canSeeFees(role)` (`apps/api/src/http/fee-visibility.ts`), with a teacher test per endpoint that carries money | FR-1.4 "no access to fees" must hold for every response, not just the fee endpoints |
| 32 | 2026-10 | Attendance sync merges per student (`ON CONFLICT` upserts in one transaction); students not sent keep their mark; only students enrolled on that date can be marked; `taken_by`/`updated_by` use `ON DELETE SET NULL` | Two phones can take the same batch offline; deleting a teacher's account must not delete or block history |
| 33 | 2026-10 | The worker runs from the `api` package as a second process (`src/worker.ts`, own composition root `worker-container.ts`; shared domain wiring in `services.ts`). The outbox table is the message queue (`FOR UPDATE SKIP LOCKED`); BullMQ is added with scheduled jobs | The send path must re-check data through the same domain modules; a separate package would first need every module extracted into a library. Same image, separate process, so scaling stays independent |
| 34 | 2026-10 | Absence alerts: decided at sync (plan feature `automatic_messages` + institute setting `absenceAlerts`, default on; expire 10:00 local next day), queued once per session (`alerts_enqueued_at`), re-checked at send (consent, global STOP, quiet hours, still absent) | Parents must never get a stale or unwanted "absent" message; the outbox keeps API requests fast and messages retryable |
| 35 | 2026-10 | A multi-month cycle's anchor is DERIVED: the period of the enrollment's first cycle invoice. `enrollments.cycle_anchor` is not written | Writing it would be a second (cross-module) write after the invoice insert; a crash in between could bill a quarterly student again next month. The invoice table is the single source of truth |
| 36 | 2026-10 | Invoices snapshot `description` (batch + period label) and `batch_id`; label names the months billed ("Oct 2026" even when billing day 5 runs to 4 Nov). Archived batches and students who left are not billed. Cancel only unpaid invoices; part-paid ones are waived | Receipts must not change when a batch is renamed; parents read "Oct 2026", not two months; cancelling part-paid money would orphan payments |
| 37 | 2026-10 | Billing runs in the worker every 15 min (`INVOICE_POLL_MS`), billing each institute's current period once via `invoice_runs`, without BullMQ | Same reasoning as #33; frequent idempotent runs give catch-up for free and need no cron precision |
| 38 | 2026-10 | Offline payments lock the invoice row (`FOR UPDATE`) for the whole record (or void) transaction; credit stays unallocated (shown, applied manually in MVP); paying a closed invoice is a 409, not credit. `Idempotency-Key` on record-payment is the first use of AGENTS rule 6: `unique (institute_id, idempotency_key)`, repeat = 200 with the first result | Without the lock, 10 parallel Rs 200 payments applied Rs 2000 to a Rs 1500 invoice (tested). A double tap on "Record payment" must never record cash twice |
| 39 | 2026-10 | One `message_usage` table (sent per institute per local day) replaces `usage_counters` + `daily_usage`; month and trial totals are sums. Check-and-increment runs under `pg_advisory_xact_lock` per institute; a failed send releases its unit | One table, one atomic rule for every cap. Without the lock 12 messages passed a cap of 5 in a 20-worker test |
| 40 | 2026-10 | Fee reminders are planned without content and rendered at send time (one child -> `fee_reminder`, siblings -> `fee_reminder_multi`, nothing due -> skipped); guardian name from any sibling's record; queued reminders expire 21:00 the next day; "remind now" answers 202 with `scheduledFor`, and is 402 on Free | FR-5.4: a reminder must reflect payments made while it waited; Free has no messages from our number |
| 41 | 2026-10 | Audit log stores no personal data (statuses, amounts, ids); written after the action succeeds. Erasure keeps the guardian's phone if a sibling at the institute still uses it | An audit trail that copies phones would undo erasure; a sibling's guardian is still an active parent of the institute |
| 42 | 2026-10 | Notices: three kinds (general / holiday / schedule_change) mapped to the three KB templates; no links at all (no own domain yet); one message per guardian; daily limit 2 (trial) / 5 (paid) counted atomically; all members may send | Matches API_DOCS roles; structured kinds survive if Meta rejects free text; the limit protects the shared number |
| 43 | 2026-10 | Tests & result cards built in the MVP (P-4 decided: not moved to v1.1). Write = owner + teacher, behind the `result_cards` feature; read and delete on any plan. Marks `numeric(6,2)`, 0..max with ≤ 2 decimals; `marks <= max_marks` kept under a `FOR UPDATE` lock on the test row (concurrency-tested). One card per student with marks (absent/left/erased get none), dedupe `result:{testId}:{studentId}` (a second tap only sends newly marked students), re-rendered from current marks at send time, expires after 3 days. `result_card` template gains `{{institute}}`. Erasure cancels queued cards and blanks their params; marks stay (no name once erased) | Pro needs its differentiator at launch, and the feature is small on top of attendance. Every institute sends from one shared number, so a card without the institute's name is ambiguous for parents. Teachers correct typos after tapping Send: rendering at send time fixes that without resending |
| 44 | 2026-10 | Data rights. **Export:** async job → ZIP of CSVs in a `FileStore` (local folder in dev, S3 in ap-south-1 later; local refused in production), downloaded only through the authenticated API (no public/signed links), kept 7 days, one in progress per institute, 5/day, any plan, allowed while deletion is pending. **Deletion:** fresh SMS code to the owner's own phone; while pending, non-owners 404, owner read-only (+ export, cancel), no messages, no billing (no back-billing after cancel); purge after 30 days in one transaction, institute row kept as a tombstone with our subscription record. **Rule 12 exception:** `DrizzleTenantDataRepository` reads (export) and deletes (purge) across all tenant tables; a schema test forces every new tenant table onto both lists | An export and a purge are about every table at once and the purge must be atomic; going through 12 services would be slower and could leave half-deleted institutes. The export holds every guardian phone, so a bearer link that can be forwarded is the wrong default. The read-only window stops data changing while the owner decides, and cancel restores everything |
| 45 | 2026-10 | Receipts: numbered `RCT-000001` per institute (in the payment's transaction: no gaps); the receipt WhatsApp is queued per payment on Starter+ (Free shares the receipt from the app), written at send time, skipped if voided, sent despite STOP. Credit: = active payments − their allocations, per guardian phone, shown on each of their students (owner/staff); applied by hand per invoice (owner/staff), oldest payment first, audited. Not applied automatically to new invoices yet (v2) | Indian institutes and parents expect a receipt number. Rendering at send time keeps a voided payment from being confirmed to a parent. Manual apply keeps the owner in control of where extra money goes; the lock order (payments → invoice, like void) is what makes it safe |
| 46 | 2026-10 | Hardening. **Plan cache:** 30 s per process in front of the subscription lookup (a decorator; a plan change reaches other instances within 30 s, the own process at once). **Read-only after downgrade:** computed, never stored — active students ordered by joined date (then id), those past the plan limit are read-only: no edit/enroll/marks (402 `read_only`), attendance sync skips them (offline phones must not lose a class's marks), billing skips them; money in, leaving and erasure always work. **Rate limits:** 600/min per IP, 300/min per user, fail open if Redis is down (OTP limits stay fail-closed). **Lint/CI:** ESLint with typescript-eslint type-aware rules (floating promises, no `any`, type imports); `no-unsafe-*` off in tests (`inject().json()` is `any`); GitHub Actions runs format, lint, typecheck and tests (Testcontainers). **Seed:** `pnpm db:seed` builds a demo institute through the services | Oldest-first keeps long-standing classes working when someone joined yesterday. A limiter outage must not become an app outage, but SMS money and account takeover justify fail-closed for OTPs. Type-aware lint catches the forgotten `await`, the bug tests miss most often |
| 47 | 2026-10 | Mobile app: Expo SDK 58 (latest stable at start), Expo Router, **React Native Paper** (Material 3) as the only UI library, TanStack Query (persisted) + Zustand, i18next (en + hi). **Android first**; iOS later from the same code. App lives in `apps/mobile` | Paper: Material look Android users know, accessible components, theming and dark mode built in, no compiler step to maintain alone. One UI library only, so screens stay consistent. Most owners use Android; Apple review and subscription rules can wait until the MVP proves itself |
| 48 | 2026-10 | Re-adding a student to a batch whose enrollment still runs on the start date (removed today, or leaving on a later date) **reopens** that enrollment (end date cleared, same id, new terms if sent, no new invoice) instead of `409`; with a gap, a new enrollment as before; one that starts after the new start date stays `409` | "Remove" sets the last day to today, so a same-day "add back" clashed and left the student stuck (owner feedback). A new enrollment would bill a `one_time` fee twice; reopening keeps one record and one invoice |
| 49 | 2026-10 | **Roll number** per student: optional text (≤ 20 chars, "12", "12A"), set when adding and editable; unique among the institute's **active** students, case-insensitive (partial unique index; `409 field=rollNumber`); cleared on erasure. Registers and marks sheets are ordered by roll number naturally (2 before 10; `compareRollNumbers` in shared), students without one last by name. Search matches an exact roll number | Owner request. Text, because schools use "12A"/"B-07". Unique only among active students so a left student's number can be reused next session. One comparator in `packages/shared` so API and app order alike |
| 50 | 2026-10 | **Student's own number** (`students.student_phone`, optional, ≠ guardian phone). It has its **own** consent record (consent belongs to a number; `studentConsent` at add time, a separate switch on the profile, asked again for a new number). The app's Call / WhatsApp ask "Parent or Student?" when it exists. Automatic messages (fee reminders, absence alerts, notices, results, receipts) go to it too as separate messages (own dedupe keys), **only with its consent** (checked at send time), each counting against the quota; a fee reminder there covers only that student's dues; "remind now" queues both. Erasure clears it and forgets its consent and queued messages | Owner request: older students have phones. Students are often minors (DPDP: verifiable parental consent), so a parent-confirmed, per-number consent is required before anything automatic goes to a child's phone |
| 51 | 2026-10 | **No payment gateway for parents in the MVP.** Parents pay the institute directly (cash, its own UPI ID, bank transfer); the owner or staff records it (`payments.method`: `upi`/`cash`/`bank`/`other`; every payment can be voided). Reminders, receipts and result cards carry **no links**: the text says what's due / what was received / the marks. No pay page, payment links, payouts/KYC, payment webhooks or public parent pages; removed from the schema (`payments.provider`, `provider_payment_id`, `payment_link_id`, `institutes.payout_*`; `upi_vpa` kept for an optional "pay to this UPI ID" line). **Razorpay is used only for Coaching Desk's own subscriptions** (owners paying for plans). The website on coachingdesk.in is a small static site (home, privacy policy, terms, account-deletion instructions, contact) for Google Play and Meta verification. Supersedes #8, #9, #24, P-1, P-2 | Owner feedback: small institutes refuse the ~2% + GST gateway cut, want money instantly (no T+2 settlement), and parents are easy phishing targets: if real messages NEVER contain a payment link, any fee link a parent receives is fake. Can return later as an opt-in (the `PaymentProvider` slot stays in the architecture) |

## 7. Open questions

1. **Final product name** (working name: Coaching Desk). Check Play Store, domain (.in/.app fallback), trademark.
2. **In-app subscription billing:** confirm current Google Play / Apple rules for Indian B2B SaaS subscriptions (store billing vs. alternative billing vs. web checkout).
3. **DPDP Act + DPDP Rules, 2025** (Rules notified Nov 2025, obligations phased in — confirm exact dates). Working assumption: the **institute is the Data Fiduciary**, we are its **Data Processor** (needs a processing agreement in our terms). Children's data needs verifiable parental consent — the institute's duty, but our consent checkbox/flow must support it. Children's data must not be used for tracking or behavioural monitoring → no product analytics on guardian pages. Still to confirm with a lawyer: consent wording, retention periods, breach-notification process, whether we have any direct obligations.
4. **WhatsApp provider:** Meta Cloud API direct vs. a BSP (support, onboarding, pricing).
5. **Payment provider** linked-account onboarding friction for tiny tutors; fallback for those without KYC. Also: Route vs Partner model (§8 P-2), and whether direct UPI should be the default (§8 P-1).
6. SMS fallback in v1.0 or v1.1?
7. Proration for mid-cycle joiners — needed by users?
8. **GST:** are plan prices GST-inclusive or exclusive? We need GST registration and GST invoices for subscriptions once over the threshold (confirm with a CA).
9. **Message economics vs NFR-14:** at full quota, messaging alone exceeds 25% of every paid plan (see §3 cost check). Options: lower included quotas, raise prices, define NFR-14 against expected (not maximum) usage, use free customer-service-window sends where possible, and re-price message packs above cost.
10. **Free/Starter members:** plans table gives Free and Starter 0 members besides the owner, but our ICP includes 1–3 teacher centers. Should Starter allow 1–2 teachers?
11. **Data residency:** DPDP doesn't generally require data to stay in India (cross-border transfer is allowed except to restricted countries). Keeping everything in ap-south-1 is a **product choice** (trust, sales pitch), not a legal requirement — confirm and keep or relax.

## 8. Product proposals (not yet decided)

Ideas from the doc review, kept here so they stay visible. Each one is a **proposal**: the rest of the docs still describe the current plan. When one is accepted, add it to the decision log (§6), update the affected docs, and change its status here.

| ID | Proposal | Why | What it would change | Status |
|---|---|---|---|---|
| P-1 | **Make direct UPI the default payment mode.** Pay page shows a `upi://pay` QR/button for the institute's own UPI ID plus an "I've paid" button; the owner confirms with one tap. Razorpay links become an opt-in for owners who want automatic reconciliation. | Tutors already receive UPI free and with no KYC. Gateway fees and KYC paperwork are likely the biggest objections. Today the UPI ID is only a fallback until KYC (decision #24). | Pay page, new "guardian says paid → owner confirms" flow, onboarding (no KYC step), F-09 wording, dashboard "awaiting confirmation" state | Proposed — test the fee/KYC objection in Phase 0 calls |
| P-2 | **Check Razorpay Route vs Partner/sub-merchant model before building payouts.** With Route, money lands in our merchant account first and is then transferred to the institute; with the Partner model, each institute has its own account and we act on its behalf. | Route may conflict with "we never hold institute money" (decision #6) and may bring payment-aggregator obligations. | `PaymentProvider` onboarding, payouts endpoints, KNOWLEDGE_BASE → Payments, open question 5 | Proposed — ask Razorpay in week 0 |
| P-3 | **Launch Android-only.** Ship iOS after the MVP proves itself. | Most owners use Android phones. Skips Apple review and Apple subscription rules for now. Expo keeps iOS cheap to add later. | ROADMAP Phase 5, store-billing open question 2 (Play only), TECH_STACK rejected-alternatives note | **Decided 2026-10-20: Android first** (decision #47) |
| P-4 | **Move tests/result cards (F-14) and possibly notices (F-15) to v1.1.** | Shrinks a tight 12-week solo plan: fewer screens and fewer WhatsApp templates to get approved. Fees + attendance are the core value. Meta verification, template approval and Razorpay activation can each take weeks. | REQUIREMENTS §2.1, ROADMAP Phase 4, Pro plan "Included" column (Pro would need another differentiator at launch) | **Decided 2026-10-20: built in the MVP** (decision #43; notices #42) |
| P-5 | **Message language per guardian**, not per institute (`guardian_contacts.locale`, default = institute's `messageLanguage`). | One center often has both Hindi- and English-preferring parents. | `guardian_contacts` schema, send worker template locale, student form | Proposed |
| P-6 | **Pick the mobile UI library now** (suggest React Native Paper: simpler, Material look familiar to Android users). | "Paper or Tamagui" left open means AI agents will mix both. | TECH_STACK → Mobile UI | **Decided 2026-10-20: React Native Paper** (decision #47) |
| P-7 | **Fewer observability vendors for MVP:** Sentry (errors, all apps) + one log service (CloudWatch or Better Stack). Add OpenTelemetry/Grafana at Growth stage. | Each vendor is another account, SDK, and bill for a solo developer. Queue depth/latency can be exported as simple metrics to the same log service at first. | TECH_STACK → Logging/Errors/Metrics rows, ARCHITECTURE §11 | Proposed |
