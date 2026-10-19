# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.

## Project in one paragraph

**TuitionMitra** (working name) is a mobile app for small offline tuition centers, home tutors, and academies in India. Owners/teachers use the app; guardians (parents) only receive WhatsApp messages and open web links. Core value: automatic fee reminders with UPI payment links, attendance with absence alerts, receipts, results, and notices.

## Read before working

| If you are touching… | Read |
|---|---|
| Anything | `docs/KNOWLEDGE_BASE.md` (business rules, glossary) |
| A feature / behavior | `docs/REQUIREMENTS.md` |
| Structure, flows, infra | `docs/ARCHITECTURE.md` |
| Schema, state machines, algorithms | `docs/LLD.md` |
| Endpoints | `docs/API_DOCS.md` |
| Libraries / tools | `docs/TECH_STACK.md` |
| Adding a backend feature module | `.claude/skills/add-feature-module/SKILL.md` |

## Repo map

```
apps/mobile    Expo React Native app (owner/teacher)
apps/api       Fastify API (modular monolith)
apps/worker    BullMQ workers + schedulers
apps/web       Next.js guardian pages, landing, free tools
packages/shared     Zod schemas, types, money/date/phone utils, error codes
packages/db         Drizzle schema + migrations + seed
packages/providers  WhatsApp / SMS / payment adapters + fakes
packages/i18n       en.json, hi.json
packages/config     shared eslint / tsconfig / prettier presets
infra/              Terraform
```

## Commands

```bash
pnpm install
docker compose up -d          # postgres + redis
pnpm db:migrate               # apply migrations
pnpm db:seed                  # demo institute with batches/students
pnpm dev                      # api + worker + web (turbo)
pnpm --filter mobile start    # expo
pnpm test                     # all tests
pnpm turbo test --filter=api  # one package's tests (note: `pnpm test --filter x` passes the flag to the test runner)
pnpm lint && pnpm typecheck
pnpm db:generate              # create migration after schema change
```

## Non-negotiable rules

1. **Tenancy:** every tenant-owned query filters by `instituteId`. Repo functions take `instituteId` as a required first argument. Never trust an `instituteId` from the URL or body — tenant routes run `[requireAuth, requireMember]` (`apps/api/src/http/tenancy-guard.ts`) and controllers read `currentTenant(request).instituteId`. Non-members get 404, never 403. Other ids in the URL (e.g. `:batchId`) are read with `uuidParam()` (`apps/api/src/http/route-params.ts`) and looked up *within* the tenant — another institute's id is a 404.
2. **Money:** integer paise, field names end with `Paise`. Postgres `bigint`; in TypeScript a safe-integer `number` (not JS `BigInt`) validated by `zMoneyPaise`. No floats, and no ad-hoc arithmetic — use the helpers in `packages/shared/src/money.ts`.
3. **Time:** inject `Clock`; never call `new Date()` / `Date.now()` in services. Store UTC; business dates are institute-local `date`s. Use `packages/shared/src/dates.ts`.
4. **Messages:** never call a messaging provider directly from API code. Insert into `message_outbox` (with a `dedupe_key`) and let the worker send. **Only exception:** login OTPs, which the `auth` module sends synchronously via `SmsProvider` because the user is waiting on the screen (still rate-limited, never logged).
5. **Webhooks:** verify signature → persist to `webhook_events` → enqueue → return 200. No business logic in the handler.
6. **Idempotency:** mutating endpoints accept `Idempotency-Key`; jobs must be safe to run twice (use unique constraints + `ON CONFLICT`).
7. **Validation:** Zod schemas live in `packages/shared` and are used by API, mobile, and web. Do not duplicate types by hand.
8. **Entitlements:** check plan limits via the `entitlements` service, never by comparing plan names in feature code.
9. **PII:** don't log phone numbers (mask), OTPs, tokens, or payloads with guardian data.
10. **i18n:** no hard-coded user-facing strings in mobile/web — add keys to both `en.json` and `hi.json`.
11. **Migrations:** forward-only and backward-compatible. Never edit an applied migration.
12. **Layers:** routes → service → repo. A module may call another module's service, never its repo or tables.

## Code style

- TypeScript `strict`; no `any` (use `unknown` + narrowing).
- Named exports; one module per folder; file names `kebab-case` or `<module>.<layer>.ts`.
- Errors: throw `AppError(code, message, details)` with codes from `packages/shared/src/errors.ts`.
- **Paradigm: OOP + SOLID** (see `docs/LLD.md` §4):
  - Domain concepts are classes: **value objects** (`Money`, `PhoneNumber`, `LocalDate` — immutable, validated in the constructor/factory) and **entities** with behaviour (e.g. `invoice.applyPayment()`), not bags of data.
  - **Services** are classes whose dependencies are **interfaces passed into the constructor** (no `new` of collaborators inside, no importing singletons).
  - **Repositories**: an interface per aggregate (`InvoiceRepository`) + a Drizzle implementation (`DrizzleInvoiceRepository`). Services depend on the interface.
  - **Providers**: interface + real + `Fake*` implementations, interchangeable everywhere (Liskov).
  - Small, focused interfaces (`Clock`, `IdGenerator`, `MessageSender`) over one big "utils" object.
  - Wiring happens in one **composition root** per app (`apps/api/src/container.ts`, `apps/worker/src/container.ts`) — hand-written, no DI framework.
  - Prefer composition over inheritance; inheritance only for true "is-a" (e.g. `AppError` subclasses).
  - Methods that implement business rules stay pure (no I/O inside entities/value objects) so they're easy to unit test.
- **Practical OOP, not OOP everywhere:**
  - Mobile and web UI are **React function components + hooks** — never class components.
  - Glue code stays **plain functions**: route registration, Zod schemas, config, small helpers (`maskPhone()`).
  - No deep inheritance hierarchies (`BaseService → CrudService → …`), no DI framework/decorators, no getters/setters for every field, no abstract base class until a second real implementation exists.
- Tests live in a `__tests__/` folder next to the code they test (e.g. `src/__tests__/money.test.ts`).
- Formatting is Prettier's job (`pnpm format`); don't hand-format or argue style in reviews.
- Comments explain *why*, not *what*.

## Testing expectations

- New business rule → unit test.
- New repo query / transaction → integration test (Testcontainers).
- New endpoint → API test covering: unauthenticated, wrong role, other tenant's id (must 404), validation error, happy path.
- Provider interactions use fakes; webhook parsing uses fixtures in `packages/providers/__fixtures__`.
- **Fakes and in-memory implementations are for tests and local dev only.** `container.ts` refuses to start with `NODE_ENV=production` if any `Fake*` / `InMemory*` implementation is wired in.
- **Every interface with a fake gets a contract test suite**: one shared set of tests run against both the fake and the real implementation (e.g. `InMemoryRateLimiter` and `RedisRateLimiter` via Testcontainers), so the fake provably behaves like production.
- **Shared state must be concurrency-safe**: counters, attempt limits, and quotas use atomic operations (Redis `INCR`/`HINCRBY`, SQL `UPDATE … RETURNING`, unique constraints) — never read-then-write in application code. Several API instances run in production.

## Definition of done

- [ ] Lint, typecheck, tests pass
- [ ] Docs updated if behavior/API/schema changed (`API_DOCS.md`, `LLD.md`, `KNOWLEDGE_BASE.md` decision log)
- [ ] Translations added (en + hi)
- [ ] No secrets, no PII in logs
- [ ] Migration included for schema changes

## Don'ts

- Don't add new dependencies without a reason in the PR description.
- Don't introduce new infrastructure (queues, DBs, services) — propose it in `KNOWLEDGE_BASE.md` open questions first.
- Don't build out-of-scope features (video, live classes, course selling, student app).
- Don't change pricing/plan numbers in code — they live in `packages/shared/src/plans.ts` and must match `KNOWLEDGE_BASE.md`.
