# Coaching Desk (working name)

Fees and parent updates on autopilot for small tuition centers, home tutors, and academies in India. Parents get WhatsApp messages and pay via UPI links — no app install.

## Docs

| File | What's inside |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules and commands for AI coding agents |
| [CLAUDE.md](CLAUDE.md) | Claude Code entry point (imports AGENTS.md) |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Target users, features (MVP/v2), plans, functional & non-functional requirements |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | High-level design: components, flows, tenancy, reliability, security, scaling |
| [docs/LLD.md](docs/LLD.md) | Low-level design: schema, state machines, module layout, interfaces, algorithms |
| [docs/API_DOCS.md](docs/API_DOCS.md) | REST API reference |
| [docs/TECH_STACK.md](docs/TECH_STACK.md) | Technology choices and rationale |
| [docs/KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) | Domain glossary, business rules, templates, decisions, open questions |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 12-week MVP plan |
| [.claude/skills/add-feature-module/SKILL.md](.claude/skills/add-feature-module/SKILL.md) | Agent workflow for adding a feature |

## Quick start (once code exists)

```bash
pnpm install
docker compose up -d
pnpm db:migrate && pnpm db:seed
pnpm dev
```
