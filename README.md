# SleepOps
SleepOps is a constraint-driven sleep operating system that protects a non-negotiable 9h sleep block, compiles 9–5/10–6 schedules into bedtime and wake rules, compresses ADHD-heavy mornings into 60–90 min launch sequences, and runs on laptop Chrome + iPhone as your evening shutdown firewall against hyperfocus, drift, and chaos.

## Tech stack

**Recommended stack for SleepOps:**

| Layer | Choice | Why |
| --- | --- | --- |
| App | **Next.js + TypeScript** | Strong default for a polished full-stack PWA. The App Router uses modern React features such as Server Components, Suspense, and Server Functions. |
| UI | **Tailwind CSS + shadcn/ui** | Fast, clean, low-friction UI stack for dashboards, cards, forms, and ADHD-friendly “one clear next action” screens. |
| Storage | **Supabase Postgres** | Full Postgres database with Auth, Realtime, Storage, Edge Functions, backups, and extensions in one platform. |
| ORM | **Prisma** | Type-safe TypeScript ORM with good developer experience, migrations, and a documented Next.js integration path. |
| Tests | **Vitest + Playwright** | Vitest for fast unit/domain tests; Playwright for end-to-end browser testing across Chromium, Firefox, and WebKit. |
| App format | **Progressive Web App** | Best fit for laptop Chrome + iPhone access from one codebase, with installability and offline-capable behavior. |
| Deploy | **Vercel** | Natural hosting target for Next.js projects with simple CI/CD and preview deployments. |

### Key references

- [Next.js App Router](https://nextjs.org/docs/app)
- [Supabase Docs](https://supabase.com/docs)
- [Prisma with Next.js](https://www.prisma.io/docs/guides/frameworks/nextjs)
- [Vitest](https://vitest.dev/)
- [Playwright](https://playwright.dev/)
- [MDN: Progressive Web Apps](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
- [Vercel: Next.js on Vercel](https://vercel.com/frameworks/nextjs)
