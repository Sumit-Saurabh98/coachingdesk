# TECH_STACK.md

Principle: **one language (TypeScript) end to end, boring managed infrastructure, few moving parts.** A solo developer must be able to run, debug, and deploy everything.

## 1. Summary

| Layer | Choice | Why |
|---|---|---|
| Mobile app (owner/teacher) | **React Native + Expo (SDK latest stable), TypeScript** | One codebase for Android + iOS; OTA updates via EAS Update; reuse React skills |
| Mobile navigation | Expo Router | File-based routing, deep links for free |
| Mobile state/server cache | TanStack Query (persisted) + Zustand (UI state) | Offline cache, retries, optimistic updates |
| Mobile local storage | expo-sqlite (offline attendance queue) + MMKV (small KV) | Fast, works on low-end phones |
| Mobile UI | React Native Paper or Tamagui (pick one, keep it) + custom theme — proposal: Paper (KNOWLEDGE_BASE §8 P-6) | Ready components, light/dark |
| Mobile i18n | i18next + react-i18next | EN + HI at launch |
| Guardian web pages + landing + free tools | **Next.js (App Router)** | SSR for fast pay/receipt pages on slow phones; SEO for landing & free tools |
| API | **Node.js (LTS) + Fastify + TypeScript** | Fast, schema-first, good plugin system |
| Validation / contracts | **Zod** (shared package) + `fastify-type-provider-zod` | Same schemas on mobile, web, API; generates OpenAPI |
| Database | **PostgreSQL 18** (or the newest major RDS supports in ap-south-1 at setup; minimum 17) | Relational data (fees, attendance), transactions, JSONB where needed |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-close, typed, lightweight migrations |
| Jobs / queues / cron | **BullMQ (v5.16+) on Redis** — Job Schedulers for cron, not the deprecated repeatable-jobs API | Reminders, invoice generation, webhook processing. **Message sending** uses the outbox table itself as the queue (`FOR UPDATE SKIP LOCKED` polling), so BullMQ is added only when scheduled jobs arrive (KB #33) |
| Cache / rate limits | Redis (same instance in MVP), `maxmemory-policy noeviction`, AOF on | OTP throttling, idempotency keys, rate limiting |
| WhatsApp | **WhatsApp Business Platform** via Meta Cloud API, behind a `MessagingProvider` interface (BSP like Gupshup/Interakt can be swapped in) | Templates, delivery webhooks |
| SMS / OTP | MSG91 (or similar DLT-registered Indian SMS provider) behind `SmsProvider` interface | OTP + fallback; DLT compliance handled by provider |
| Guardian payments | **Razorpay** (Payment Links + Route/linked accounts) behind `PaymentProvider` interface; Cashfree as alternate | UPI links, webhooks, settlement to institute |
| Subscription billing | Decide after store-policy check: RevenueCat (store billing) **or** Razorpay Subscriptions (web checkout) | See KNOWLEDGE_BASE open questions |
| File storage | AWS S3 (ap-south-1) + CloudFront | Logos, generated PDFs |
| PDF generation | `@react-pdf/renderer` in worker (v2 reports) | No headless browser needed |
| Auth | Custom: phone OTP → JWT (access, 15 min) + rotating refresh token (hashed in DB) | Simple, no vendor lock-in |
| Hosting (API, worker) | **AWS ap-south-1 (Mumbai)**. MVP: one EC2 instance running api + worker containers (docker compose, Caddy for TLS), RDS Postgres (managed backups + PITR for NFR-10), ElastiCache Redis. Growth: move api/worker to ECS Fargate + ALB | Data in India; known AWS experience; no ALB/NAT cost at MVP. (Railway/Render dropped: no India region.) |
| Web hosting | Vercel with serverless function region `bom1` (Mumbai), or the same EC2 | Guardian pages are server-rendered from India-hosted API data |
| Infra as code | Terraform | Reproducible envs |
| CI/CD | GitHub Actions; EAS Build/Submit for mobile | Free tier sufficient early |
| Monorepo | **pnpm workspaces + Turborepo** | Shared packages, cached builds |
| Logging | pino (JSON) → CloudWatch / Better Stack | Structured, cheap |
| Errors | Sentry (mobile, web, API, worker) | One place for all errors |
| Metrics/Tracing | OpenTelemetry → Grafana Cloud free tier — proposal: defer to Growth stage (KNOWLEDGE_BASE §8 P-7) | Queue/latency visibility |
| Product analytics | PostHog — **owner/teacher app and landing page only; never on guardian pages** (DPDP: no tracking of children's data) | Funnels: signup → activation → paid |
| Testing | Vitest (unit), Testcontainers (Postgres/Redis integration), Supertest-style `fastify.inject` (API), Maestro (mobile E2E), Playwright (web) | Fast and realistic |
| Lint/format | ESLint (typescript-eslint) + Prettier | Standard |
| Feature flags | Simple DB table + cached config (MVP); PostHog flags later | No extra vendor |

## 2. Repo layout

```
coachingdesk/            # repo root (product working name: TuitionMitra)
├── apps/
│   ├── mobile/          # Expo app (owner/teacher)
│   ├── api/             # Fastify HTTP API
│   ├── worker/          # BullMQ workers + schedulers
│   └── web/             # Next.js: guardian pages, landing, free tools
├── packages/
│   ├── shared/          # Zod schemas, types, constants, money/date utils
│   ├── db/              # Drizzle schema, migrations, seed
│   ├── providers/       # WhatsApp, SMS, payments adapters (interfaces + impls + fakes)
│   ├── i18n/            # Translation JSON (en, hi)
│   └── config/          # eslint, tsconfig, prettier presets
├── infra/               # Terraform
├── docs/                # These documents
├── .claude/skills/      # Agent skills
├── AGENTS.md
└── CLAUDE.md
```

## 3. Versions policy

- Pin exact versions in lockfile; Renovate opens weekly update PRs.
- Node.js: active LTS only (currently 24; `@types/node` major must match the runtime).
- TypeScript: pinned to `~6.0.x`. TypeScript 7 (native Go compiler) is out, but `typescript-eslint` and other tooling support only `<6.1` as of 2026-10. Re-check peer ranges before upgrading.
- Expo: upgrade one SDK at a time, within 2 months of release.
- Postgres: managed minor upgrades automatic; major upgrades planned.

## 4. Environments

| Env | Purpose | Notes |
|---|---|---|
| local | Development | `docker compose` for Postgres + Redis; providers use **fakes** by default |
| staging | Pre-release testing | Real provider sandboxes (Razorpay test mode, WhatsApp test number) |
| prod | Live | ap-south-1; separate AWS account |

## 5. Rejected alternatives (and why)

| Option | Reason not chosen (for now) |
|---|---|
| Flutter | Would add Dart; TypeScript already shared across stack |
| Firebase as backend | Hard to model fees/invoices relationally; vendor lock-in; complex queries |
| NestJS | More boilerplate than needed for a solo dev; Fastify + modules is enough |
| Prisma | Heavier runtime; Drizzle keeps SQL visible (fine either way) |
| Microservices | Unnecessary; modular monolith + worker is enough to 20k institutes |
| Kafka | BullMQ covers throughput needs for years |
| Building native Android first | iOS needed for some academy owners; Expo gives both |

## 6. Estimated monthly infra cost (MVP, < 500 institutes)

Rough ballpark only — check current AWS pricing for ap-south-1:
- MVP setup (one small EC2, small RDS Postgres, small ElastiCache Redis, S3): roughly **$45–70/month**.
- The Fargate setup would cost roughly **$80–150/month** at MVP size: the ALB and NAT gateway alone are ~$50/month before any compute. Move to it at the Growth stage.
- WhatsApp: Meta charges **per delivered template message** (since 1 July 2025), priced by category — the **largest variable cost**. See KNOWLEDGE_BASE §3 cost check; budgeted via plan message limits.
- SMS OTP: small per-SMS cost.
- Payment gateway: per-transaction fee (typically paid by the institute or passed to guardian, configurable).
