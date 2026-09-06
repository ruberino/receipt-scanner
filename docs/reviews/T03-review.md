# Review follow-up: T03 — Kvitteringer

Review of commit `7af398b` (T03), now on `main`, 2026-09-06.
Verdict: approved with one required item.

## What was verified

All seven tables match `docs/architecture.md` section 6 column by column: every check constraint, unique constraint, foreign key with its `ON DELETE` behaviour, and the three indexes.
`drizzle/0000_initial.sql` is drizzle-kit output of the schema, and the journal tag matches the renamed file.
`openDatabase` creates the parent directory, skips WAL for `:memory:` and turns foreign keys on; `runMigrations` resolves the folder from the module path.
`buildApp` opens, migrates, decorates `db` and closes the connection in `onClose`.
`test/server/db.test.ts` covers every T03 acceptance bullet plus the unit and match-source checks, `sha256` uniqueness, the self-reference and the documented defaults.
All five scripts exit 0; 80 tests pass.

## F1 — Required: decorate `sqlite` as well as `db`

T03 step 3 says `buildApp` decorates `db` and `sqlite`; only `db` is decorated.
The upload transaction in T06 and `createReceiptProcessor({ db, sqlite, … })` in T08 need the raw connection.

Steps: `app.decorate('sqlite', sqlite)` next to `db`, and add `sqlite` to the `declare module 'fastify'` block with the `better-sqlite3` `Database` type.

Acceptance: `npm run typecheck` passes, and a test reads `app.sqlite.prepare('select 1 as one').get()` and gets `{ one: 1 }`.

## F2 — Process

The T03 commit was first made on `main` and moved to a branch afterwards; you caught and fixed that yourself within a minute, which is the right reflex.
The rule stays: `main` moves only by fast-forward merge of a task branch after its review file exists and the required items are done.

## Done

With the T02 follow-up: the five scripts exit 0, commit bodies carry the summaries, fast-forward merge into `main`.
