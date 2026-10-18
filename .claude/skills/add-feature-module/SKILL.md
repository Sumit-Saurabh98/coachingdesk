---
name: add-feature-module
description: Step-by-step workflow for adding or extending a backend feature in this repo (new API module, endpoint, table, background job, or WhatsApp message type) across packages/shared, packages/db, apps/api, apps/worker, and mobile. Use this whenever the task involves a new endpoint, new database table or column, new job/queue, new message template, or any change touching fees, attendance, messaging, or plans — even if the user only says "add X feature" or "build the Y screen API".
---

# Add a feature module

Follow these steps in order. Skip a step only if it clearly doesn't apply, and say which you skipped.

## 1. Understand the rule first
- Find the feature in `docs/REQUIREMENTS.md` and the related rules in `docs/KNOWLEDGE_BASE.md`.
- If the behavior isn't specified, ask before coding. Money and messaging mistakes reach real parents.

## 2. Contract (packages/shared)
- Add Zod schemas for request/response in `packages/shared/src/<module>/schemas.ts`.
- Export inferred types. Money fields end with `Paise` and use `zMoneyPaise`; phones use `zPhoneIN`; dates use `zLocalDate`.
- Add any new error codes to `packages/shared/src/errors.ts`.

## 3. Database (packages/db) — only if schema changes
- Edit Drizzle schema. Every tenant table has `instituteId` + index starting with it, plus `createdAt`/`updatedAt`.
- Add unique constraints that make jobs idempotent (e.g. one row per period).
- `pnpm db:generate`, review the SQL, keep it backward compatible.

## 4. API module (apps/api/src/modules/<module>/)
Create or extend:
```
<module>.routes.ts    # register routes with zod schemas; requireRole(...); no DB access
<module>.service.ts   # business logic; uses deps { db, clock, queue, entitlements }
<module>.repo.ts      # queries; first param is instituteId
<module>.test.ts
```
Checklist:
- Route path under `/v1/institutes/:instituteId/...` (unless public/webhook).
- Role check matches the table in `docs/API_DOCS.md`.
- Plan limits via `entitlements.assert(...)`.
- Writes that touch money run in a transaction with row locks.
- Audit log for money/permission changes.

## 5. Side effects
- Message to guardian? Insert into `message_outbox` with a deterministic `dedupe_key` and correct `category`. Add template to `docs/KNOWLEDGE_BASE.md` §4 (EN + HI). Never call the provider from the API.
- Background work? Add a queue/job in `apps/worker`, retries + DLQ, idempotent handler.
- Webhook? Verify → persist `webhook_events` → enqueue → 200.

## 6. Tests
- Unit tests for pure rules (dates, money, limits).
- Integration tests with Testcontainers for repo + transactions.
- API tests: 401, 403 (wrong role), 404 (other institute's id), 422, happy path.
- Job tests: running twice produces the same result.

## 7. Mobile / web (if UI is part of the task)
- Use the generated typed client; TanStack Query hooks in `apps/mobile/src/features/<module>/`.
- All strings in `packages/i18n` (en + hi).
- Handle offline: show cached data and a clear offline state.

## 8. Docs & finish
- Update `docs/API_DOCS.md` (endpoints), `docs/LLD.md` (schema/state), decision log if a rule changed.
- Run `pnpm lint && pnpm typecheck && pnpm test`.
- Summarize: files changed, migration (yes/no), tests added, open questions.
