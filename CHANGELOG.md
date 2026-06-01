# Changelog

SleepOps uses this file as a high-level release and milestone outcome log.
GitHub milestones, issues, pull requests, and releases remain the canonical
task-level record.

## Unreleased - MVP 2.0

Goal: SleepOps turns one-night planning into a durable daily operating loop.

Milestone 2 should make SleepOps useful across repeated days: remember plans,
compare planned vs actual behavior, surface risk earlier, and make evening
guardrails harder to miss.

Planned:

- Daily plan history
  - Save each day's compiled sleep plan.
  - Track actual shutdown start, lights-out, wake time, and morning launch
    result.
  - Compare planned vs actual sleep and morning duration.
- Tomorrow risk compiler
  - Produce a clear tomorrow risk level: low, medium, high, broken.
  - Base risk on overbooked time, missed shutdown, routine trend, and sleep
    deficit.
  - Show explicit tradeoffs when the day does not fit.
- Evening guardrail rails
  - Add latest caffeine cutoff.
  - Add latest screen-off / laptop-off deadline.
  - Add pre-shutdown warning rails before the hard shutdown assistant takes
    over.
- Local-first durable storage
  - Move MVP state and history to a small IndexedDB/local-first storage layer.
  - Migrate existing v1 localStorage data safely.
  - Keep the app usable offline and across reloads.
- Notification hardening
  - Keep explicit user-controlled reminder setup.
  - Add the strongest supported reminder behavior per platform.
  - Use true service-worker/Web Push only where technically supported.
  - Gracefully explain limitations on unsupported browsers and iPhone contexts.

Not planned for this milestone:

- Supabase remote sync
- Auth
- Google Calendar integration
- Wearable or sleep-device integration
- Complex analytics beyond simple plan-vs-actual trends

Links:

- Milestone: https://github.com/mathemage/SleepOps/milestone/2

## v1.4.0 - 2026-05-24

Completed MVP 1.0: Given tomorrow's work start, SleepOps tells me when I must
shut down tonight.

Added:

- Fixed 9h sleep contract compiler.
- Morning routine profiler that tracks step durations for the last 7 days.
- Top 3 morning time leak analysis.
- Routine compressor for moving tasks to evening, batching decisions, and
  creating a minimum viable morning.
- Evening shutdown assistant that starts 45-75 minutes before lights-out and
  shows one physical action at a time.
- Offline-capable PWA app shell with install-focused manifest metadata and
  icons for Chrome and iPhone home-screen use.
- Local persistence for sleep contract inputs, profiler/compressor data,
  shutdown progress, and reminder preference.
- Open-app shutdown reminders with explicit user-controlled setup and graceful
  unsupported-browser handling.

Follow-up fixes included in MVP 1.0:

- Updated default morning routine step labels.
- Updated default step durations to 15 minutes, with the post-morning commute
  step at 20 minutes.
- Clarified schedule terminology for new users.
- Narrowed persisted profiler step parsing.
- Clarified shutdown assistant step wording and order.

Key closed issues:

- #8: Build minimal scaffold
- #11: MVP 1.0 sleep contract vertical slice
- #13: Morning routine profiler
- #14: Routine compressor
- #15: Evening shutdown assistant
- #16: PWA offline access and notifications
- #19: Default morning routine step titles
- #21: Default morning routine step durations
- #24: Schedule terminology clarification
- #27: Persisted profiler parsing fix
- #29: Shutdown step clarification

Links:

- Milestone: https://github.com/mathemage/SleepOps/milestone/1?closed=1
- Release: https://github.com/mathemage/SleepOps/releases/tag/v1.4.0
