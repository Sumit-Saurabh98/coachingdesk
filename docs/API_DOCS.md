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
| DELETE | `/me` | Delete own account → `204`. `409 OWNER_OF_INSTITUTES` while sole owner of a non-deleted institute. Same flow on the web at `/delete-account` (OTP login), as Google Play requires |

## 4. Institutes & members

| Method | Path | Body / notes |
|---|---|---|
| POST | `/institutes` | `{ name, type: "tuition"\|"academy"\|"home_tutor", city? }` → creates owner membership + 30-day Pro trial |
| GET | `/institutes/{id}` | Details + settings + entitlements summary |
| PATCH | `/institutes/{id}` | `{ name?, city?, billingDay?, dueAfterDays?, settings? }` |
| GET | `/institutes/{id}/members` | List |
| POST | `/institutes/{id}/members` | `{ phone, name, role: "teacher"\|"staff" }` — adds by phone. Creates the `users` row if the phone is new; they get access on first OTP login. Member count (excluding owner) checked against plan → `PLAN_LIMIT_REACHED` |
| DELETE | `/institutes/{id}/members/{userId}` | Remove |
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

`settings` shape:
```json
{
  "absenceAlerts": true,
  "reminderOffsets": [3, 0, -3, -7],
  "quietHours": { "start": "21:00", "end": "08:00" },
  "messageLanguage": "hi"
}
```

## 5. Batches

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/batches` | `?includeArchived=true\|false` (default `false`) → `200 { batches: [...] }`, oldest first |
| POST | `/institutes/{id}/batches` | Owner, staff. See body → `201 { batch }` |
| GET | `/institutes/{id}/batches/{batchId}` | `200 { batch }`. Enrolled students count arrives with enrollments |
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
| GET | `/institutes/{id}/students` | `?q=&batchId=&status=active&limit&cursor` |
| POST | `/institutes/{id}/students` | Single student (+ optional `batchIds`) |
| POST | `/institutes/{id}/students/bulk` | Up to 500 rows; returns per-row result |
| GET | `/institutes/{id}/students/{studentId}` | Profile, enrollments, fee summary, attendance % |
| PATCH | `/institutes/{id}/students/{studentId}` | |
| POST | `/institutes/{id}/students/{studentId}/leave` | `{ leftOn }` → stops invoices/reminders |
| POST | `/institutes/{id}/students/{studentId}/erase` | Owner. Irreversibly erases the student's and guardian's personal data (on guardian request); amounts are kept |
| POST | `/institutes/{id}/enrollments` | `{ studentId, batchId, feePaise?, discountPaise?, feeCycle?, startDate, billNow?: boolean }` — `feePaise`/`feeCycle` default to the batch's. `one_time` is invoiced immediately; `billNow` bills the current monthly/quarterly/half-yearly/yearly period now |
| PATCH | `/institutes/{id}/enrollments/{enrollmentId}` | Change fee / cycle / end date (applies from the next period) |

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

Bulk response:
```json
{ "created": 18, "failed": [ { "row": 4, "code": "INVALID_PHONE", "input": "Ravi, 98765" } ] }
```

Errors: `PLAN_LIMIT_REACHED` when active students exceed plan.

## 7. Attendance

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/batches/{batchId}/attendance?date=2026-10-18` | Session + records (or empty template with enrolled students) |
| PUT | `/institutes/{id}/attendance-sessions/{clientId}` | Idempotent upsert (offline sync) |
| GET | `/institutes/{id}/students/{studentId}/attendance?from&to` | History + percentage |
| GET | `/institutes/{id}/attendance/summary?date=` | All batches today: taken/not taken, absent count |

PUT body:
```json
{
  "batchId": "0192...",
  "date": "2026-10-18",
  "submittedAt": "2026-10-18T11:32:00Z",
  "records": [
    { "studentId": "0192...a", "status": "present" },
    { "studentId": "0192...b", "status": "absent" }
  ]
}
```
→ `200` with final merged session and `alertsQueued: 1`.

## 8. Fees

| Method | Path | Notes |
|---|---|---|
| GET | `/institutes/{id}/fees/dashboard?month=2026-10` | Totals + top overdue |
| GET | `/institutes/{id}/invoices` | `?status=due,partially_paid&studentId&batchId&overdue=true` |
| GET | `/institutes/{id}/invoices/{invoiceId}` | With payments + messages sent |
| POST | `/institutes/{id}/invoices` | Manual one-off invoice `{ studentId, amountPaise, discountPaise?, dueDate, description }` (`description` required) |
| POST | `/institutes/{id}/invoices/{invoiceId}/payments` | Record offline payment. Amount above the remaining due is kept as guardian credit |
| POST | `/institutes/{id}/payments/{paymentId}/void` | `{ reason }` — owner only, offline payments only. Reopens the invoice(s); audited. `409 CONFLICT` if already voided or if `method = upi_link` (refund via provider instead) |
| POST | `/institutes/{id}/invoices/{invoiceId}/remind` | `{ force?: boolean }` → `{ scheduledFor }`. Refused with `409 ALREADY_REMINDED_TODAY` if the guardian already got a fee reminder today; `force` (owner only) allows one extra per day. Quiet hours always apply (scheduled for 08:00) |
| POST | `/institutes/{id}/invoices/{invoiceId}/waive` | `{ reason }` |
| POST | `/institutes/{id}/invoices/{invoiceId}/cancel` | `{ reason }` |
| POST | `/institutes/{id}/invoices/{invoiceId}/share-link` | Mints a guardian pay-page token for this invoice's guardian → `{ url, whatsappText }` (Free plan manual share). POST because it creates a token |
| GET | `/institutes/{id}/payments?from&to&method&status` | Collections list (`status=active` by default; voided/refunded shown when asked) |

Dashboard response:
```json
{
  "month": "2026-10",
  "collectedPaise": 4250000,
  "pendingPaise": 1800000,
  "overdueCount": 12,
  "byMethod": { "upi_link": 3100000, "cash": 1150000 },
  "topOverdue": [
    { "studentId": "...", "name": "Aarav Sharma", "guardianPhone": "+9198XXXXX210", "overduePaise": 300000, "daysOverdue": 14 }
  ]
}
```

Record payment:
```json
{ "amountPaise": 150000, "method": "cash", "paidAt": "2026-10-18T09:00:00Z", "note": "Paid at center" }
```

## 9. Tests & results

| Method | Path |
|---|---|
| GET/POST | `/institutes/{id}/batches/{batchId}/tests` |
| PUT | `/institutes/{id}/tests/{testId}/scores` — `{ scores: [{ studentId, marks?, isAbsent? }] }` |
| POST | `/institutes/{id}/tests/{testId}/send-results` → `{ queued: 28 }` |

## 10. Notices

| Method | Path |
|---|---|
| POST | `/institutes/{id}/notices/preview` — `{ batchIds, body }` → `{ recipients, messagesNeeded, quotaRemaining }` |
| POST | `/institutes/{id}/notices` — sends. `body`: 1–500 chars, no links except the institute's own; newlines/tabs are converted to " · " (WhatsApp template parameters can't contain them). Max 2 notices/day (5 on paid plans) → `429 DAILY_LIMIT_REACHED` |
| GET | `/institutes/{id}/notices` |

## 11. Messaging

| Method | Path |
|---|---|
| GET | `/institutes/{id}/messages?status&category&limit&cursor` — outbox log |
| GET | `/institutes/{id}/messages/usage` — `{ month, used, limit, todayUsed, todayLimit }` |
| GET | `/institutes/{id}/replies?limit&cursor` — guardians' WhatsApp replies routed to this institute ("Parent replies") |
| POST | `/institutes/{id}/guardians/{phone}/opt-in` — record consent `{ source: "verbal" \| "form" \| "whatsapp" }` |

## 12. Subscription

| Method | Path |
|---|---|
| GET | `/plans` — public plan catalog |
| GET | `/institutes/{id}/subscription` — plan, status, period end, usage, limits |
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
