# SleepOps
SleepOps is a constraint-driven sleep operating system that protects a non-negotiable 9h sleep block, compiles 9–5/10–6 schedules into bedtime and wake rules, compresses ADHD-heavy mornings into 60–90 min launch sequences, and runs on laptop Chrome + iPhone as your evening shutdown firewall against hyperfocus, drift, and chaos.

## **SleepOps — a “hard-constraint day compiler”**

A webapp that treats **9 hours of sleep as an invariant**, not a habit suggestion. Like a compiler: if the day does not fit, it throws an error before your evening self can negotiate with the goblin.

Adults are generally advised to get **at least 7 hours** of sleep; your 9-hour target is above the minimum and plausible if you personally function best there. Chronic sleep disturbance is also especially relevant for ADHD, where sleep problems can worsen attention/executive-function issues. ([CDC][1])

### Core concept

You enter:

```text
Required sleep: 9h
Work schedule: 9–5 or 10–6
Morning routine target: 60–90 min
Commute / prep buffer: X min
Evening shutdown time: Y min
```

The app outputs:

```text
Latest wake time
Latest lights-out time
Latest “start shutdown” time
Latest caffeine time
Latest screen-off / laptop-off time
Tomorrow risk level
```

### Example schedule logic

For a **9–5 job**:

| Constraint             | Example |
| ---------------------- | ------: |
| Work start             |   09:00 |
| Morning routine target |  75 min |
| Buffer / commute       |  30 min |
| Wake time              |   07:15 |
| Required sleep         |      9h |
| Latest lights-out      |   22:15 |
| Shutdown ritual        |  45 min |
| Latest shutdown start  |   21:30 |

For a **10–6 job**:

| Constraint             | Example |
| ---------------------- | ------: |
| Work start             |   10:00 |
| Morning routine target |  75 min |
| Buffer / commute       |  30 min |
| Wake time              |   08:15 |
| Required sleep         |      9h |
| Latest lights-out      |   23:15 |
| Shutdown ritual        |  45 min |
| Latest shutdown start  |   22:30 |

So the app’s central rule is brutal but useful:

> **If tomorrow starts at 9:00, tonight already has a deadline.**

### ADHD-specific UX

The app should **not** behave like a normal habit tracker. Normal habit trackers are where ADHD routines go to become archaeology.

It should use:

* **One-screen-next-action mode**: never show the whole morning list at once.
* **Countdown rails**: “You have 11 minutes left for hygiene.”
* **Decision removal**: clothes, breakfast, bag, meds, keys decided the night before.
* **Routine presets**: “Full”, “Compressed”, “Emergency”, “CEO call day”, “BJJ/climbing day”.
* **Anti-hyperfocus kill switch**: at shutdown time, the app hides planning/detail views and only shows: “Close laptop. Brush teeth. Bed.”
* **Calendar-aware bedtime enforcement**: if work starts at 9, the bedtime lock moves earlier automatically.

CBT-based approaches for adult ADHD commonly target planning, organization, and executive-function problems; external structure is the point, not a moral lecture from a rectangle. ([PMC][2])

### High-IQ-specific design

Your brain can probably out-argue a weak app in 14 seconds. So the app should **not** rely on motivation.

It should give you:

```text
Constraint violated:
9h sleep impossible unless one of these changes:
1. Remove evening coding block
2. Move shower to evening
3. Use compressed morning routine
4. Start work at 10:00
```

This is the key: **make the tradeoff explicit before midnight**.

### Architectural design

Build **SleepOps first**, with **Morning Bootloader as one module inside it** (TBD).

The real problem is not only “morning routine too long”. The real problem is a constraint system:

```text
9h sleep
+
fixed work schedule
+
ADHD transitions
+
evening hyperfocus
+
morning routine bloat
```

So the winning app should be a **constraint engine**, not a pretty checklist.

[1]: https://www.cdc.gov/sleep/data-research/facts-stats/adults-sleep-facts-and-stats.html "FastStats: Sleep in Adults"
[2]: https://pmc.ncbi.nlm.nih.gov/articles/PMC3414742/ "A randomized controlled trial of CBT therapy for adults with ..."
<!-- [3]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps "Progressive web apps - MDN Web Docs - Mozilla" -->

### Best implementation pattern

Make this as a **PWA with local-first storage**:

```text
Frontend: Next.js / React
Storage: IndexedDB locally + Supabase sync
Auth: magic link / passkey
Notifications: Web Push where available
Calendar: Google Calendar integration later
Charts: simple duration trends
```

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
