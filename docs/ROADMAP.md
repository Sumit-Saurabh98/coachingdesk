# ROADMAP.md

Solo developer, ~12 weeks to a paid MVP. Each milestone ends with something demoable.

## Phase 0 — Validate & set up (Week 0–1)
- [ ] 30+ phone conversations with tutors/academy owners (fees, parent updates, willingness to pay ₹299)
- [ ] Finalize name; buy domain; reserve Play Store listing name and social handles
- [ ] Create Meta Business account, WhatsApp test number; submit first templates (EN + HI)
- [ ] Razorpay account (test mode); explore linked accounts flow
- [ ] Monorepo scaffold (pnpm + Turborepo), CI, docker compose (Postgres, Redis), provider fakes
- [ ] Read store billing policy + DPDP basics → update KNOWLEDGE_BASE open questions
- [ ] Decide product proposals P-1…P-7 (KNOWLEDGE_BASE §8): ask about UPI fees/KYC in the calls (P-1), ask Razorpay Route vs Partner (P-2), choose Android-only (P-3), scope cut (P-4), UI library (P-6)

## Phase 1 — Core data (Weeks 2–3)
- [x] Auth: OTP request/verify, refresh rotation
- [x] Institutes, memberships, tenancy plugin, role checks  _(members API ✅, `DELETE /me` ✅)_
- [ ] Batches, students, enrollments, bulk import  _(API ✅: batches, students, bulk import, enrollments)_
- [ ] Mobile: login, onboarding wizard, batches & students screens, EN/HI
- **Demo:** sign up and add 20 students in under 5 minutes

## Phase 2 — Attendance (Week 4)
- [x] Attendance API + offline sync
- [ ] Mobile: Today screen, one-tap attendance, offline queue
- [ ] Outbox + send worker + WhatsApp provider; absence alerts (with late-sync expiry)  _(✅ outbox, worker, consent, absence alerts with expiry, quiet hours; ⏳ Meta WhatsApp sender needs the number)_
- [ ] WhatsApp inbound: STOP/START, auto-reply, "Parent replies"; daily caps + quality guard
- **Demo:** take attendance in airplane mode, sync, parent gets WhatsApp

## Phase 3 — Fees (Weeks 5–7)
- [ ] Invoice generation scheduler, manual invoices, offline payment recording  _(✅ invoices: billing job, at-enrollment billing, manual, waive, cancel; ✅ offline payments, void, fee dashboard API)_
- [ ] Payment links + Razorpay webhook pipeline (idempotent)
- [ ] Payout onboarding (KYC) flow + UPI-ID fallback on the pay page
- [x] Reminder planner (offsets, 1/day, quiet hours, sibling grouping)  _(+ message quota and trial/new-institute caps; pay-link token with the pay page)_
- [ ] Receipts; web pages: pay, receipt (Next.js)
- [ ] Mobile: fee dashboard, pending list, student fee history, "remind now"
- **Demo:** parent pays via UPI link → app shows paid → receipt on WhatsApp

## Phase 4 — Plans & polish (Weeks 8–9)
- [ ] Entitlements, plan limits, usage counters, trial, grace, downgrade
- [ ] Subscription checkout (per billing decision)
- [ ] Tests & result cards; notices  _(✅ notices API; ✅ tests & result cards API — public result page comes with the public links)_
- [ ] Sentry, logs, alerts, backups verified
- [ ] Privacy policy, terms (incl. data-processing terms), consent checkbox
- [ ] Data rights: export, institute deletion, student erasure, account deletion (app + web page)
- [ ] Store-review login number
- **Demo:** trial → paid flow end to end

## Phase 5 — Beta (Weeks 10–12)
- [ ] Onboard 20–50 institutes via calls + video setup
- [ ] Track: activation, attendance days/week, ₹ collected via links, trial → paid
- [ ] Fix top 10 friction points; record testimonials
- [ ] Play Store listing: keywords, screenshots, short video
- **Exit criteria:** ≥ 10 paying institutes, ≥ 60% weekly active

## After MVP (v1.1 → v2)
- SMS fallback, push notifications, Postgres RLS
- Progress report PDFs, multi-teacher per-batch access
- Lead tracker, expenses & profit, public institute page
- Referral program, free SEO web tools
- Regional languages, multi-branch
