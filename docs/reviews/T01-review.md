# Review follow-up: T01 — Kvitteringer

Review of commit `5b55475` on `task/T01-scaffold-tooling-shared-helpers`, 2026-09-06.
Verdict: not ready to merge.
There is one blocking defect in `isoWeekKey`, plus deviations from `docs/tasks.md` T01 and from the sibling app `training-log` that T01 was told to mirror.

Work this as follow-up commits on the same branch, since T01 is one pull request.
The rules in `AGENTS.md` apply.
F0 contains architect-approved text for `docs/architecture.md` and `AGENTS.md`; insert it verbatim and make no other change to those files or to any ADR.
If an item below conflicts with them, stop and ask.

## What was verified

`npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all exit 0 on the reviewed commit.
`formatOre` produces U+00A0 before `kr` and U+2212 for negative amounts, checked at code-point level in both the code and the tests.
`todayInOslo`, `mondayOf`, `diffDays`, `addDays` and `parseNok` behave as specified, and `parseNok` also tolerates U+00A0 inside the input.
The client test under `test/client/` uses the jsdom pragma correctly.
The production bundle contains the text "Kvitteringer".

## F0 — Record two architect decisions

Do this first, as its own commit with the subject `docs: record dependency version policy and no-remote merge rule`.
Both decisions were taken by the architect on 2026-09-06 after this review.

1. In `docs/architecture.md` section 3, insert this text directly after the stack table:

```md
The versions in the table are floors, not targets.
Pin exact versions in `package.json` and take the newest stable release on npm for every dependency, including a newer major, unless one of these stops it:

- a peer dependency range of another pinned package excludes it;
- it needs a different Node.js major than the Dockerfile uses, which is an ADR decision, so ask;
- `lint`, `typecheck`, `test` and `build` cannot pass with configuration changes only, or the upgrade contradicts a task or an ADR, so ask;
- the release is a pre-release, or its release notes call it unstable.

In those cases take the newest release that does work and record the reason in the commit body, one line per package.
Dependencies shared with the sibling app are pinned to the same version in both repositories.
```

2. In `AGENTS.md`, replace the bullet that starts with "New dependencies are pinned" with:

```md
- Dependencies are pinned to exact versions at the newest stable release, per the policy in `docs/architecture.md` section 3.
```

3. In `AGENTS.md`, under "Working a task", add this bullet after the "Done means" bullet:

```md
- The repository has no remote yet, so finish a task by fast-forward merging its branch into `main`; rebase onto `main` first when `main` has moved.
  Write what would have been the PR description in the body of the branch's last commit.
```

Acceptance: `git show --stat HEAD` for the docs commit lists exactly `docs/architecture.md` and `AGENTS.md`.

## F1 — Blocking: `isoWeekKey` is off by one in years that start on a Friday, Saturday or Sunday

File: `src/shared/dates.ts`, function `isoWeekKey`.

Cause: `firstThursday` is derived from the week that contains 1 January.
When 1 January falls on a Friday, Saturday or Sunday, that week belongs to the previous ISO year.
Every week number in such a year then comes out one too high, and a 52-week year gets a `W53`.
The acceptance examples in T01 pass only because 2026 starts on a Thursday.
From 4 January 2027 every week key produced by the app would be wrong.

Observed on the reviewed commit:

| Input | Returned | Correct |
| --- | --- | --- |
| `2027-01-04` | `2027-W02` | `2027-W01` |
| `2027-12-31` | `2027-W53` | `2027-W52` |
| `2023-01-05` | `2023-W02` | `2023-W01` |
| `2021-01-04` | `2021-W02` | `2021-W01` |

Fix: derive week 1 from 4 January, which is always inside ISO week 1.
Keep the function pure, with no Node or DOM imports.

```ts
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Monday = 0 .. Sunday = 6. */
function isoDayOfWeek(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/** ISO week key `YYYY-Www`: Monday start, week 1 is the week that contains 4 January. */
export function isoWeekKey(date: string): string {
  const d = toUtcDate(date);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - isoDayOfWeek(d) + 3);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Thursday = new Date(jan4);
  week1Thursday.setUTCDate(jan4.getUTCDate() - isoDayOfWeek(jan4) + 3);
  const weekNumber = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / MS_PER_WEEK);
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
}
```

This implementation was checked against an independent reference for every day from 2015-01-01 to 2035-12-31 with zero mismatches.
Reuse `isoDayOfWeek` in `mondayOf` instead of repeating the expression.

Tests to add in `test/shared/dates.test.ts`, all of which must pass:

| Input | Expected |
| --- | --- |
| `2027-01-04` | `2027-W01` |
| `2027-12-31` | `2027-W52` |
| `2028-01-01` | `2027-W52` |
| `2028-01-03` | `2028-W01` |
| `2023-01-01` | `2022-W52` |
| `2023-01-05` | `2023-W01` |
| `2021-01-03` | `2020-W53` |
| `2021-01-04` | `2021-W01` |
| `2020-12-31` | `2020-W53` |

Also add a consistency test: for each of `2025-12-29`, `2026-09-06`, `2027-01-04` and `2028-01-01`, `isoWeekKey(mondayOf(date))` equals `isoWeekKey(date)`, and `isoWeekKey(addDays(mondayOf(date), 6))` equals `isoWeekKey(date)`.
Keep every existing test.

Acceptance: every example above passes, and the T01 acceptance examples still pass.

## F2 — Resolve the `overrides` entry for `openai` and `zod`

`package.json` forces `zod` 4 into `openai` 5.23.2 through `overrides`.
`openai` 5.23.2 declares `zod ^3.23.8` as an optional peer dependency, so without the override `npm install` fails on peer resolution.
The override is safe because ADR-0003 uses JSON mode with our own zod parsing and never uses the SDK's zod helpers, but the reason is recorded nowhere.
Per `AGENTS.md`, a library behaving differently from the docs is a question, and the answer belongs in the PR description.

Steps, after F5 has settled the `openai` version:

1. Run `npm view openai@<pinned version> peerDependencies`.
   If the `zod` range allows version 4, delete the `overrides` entry and run `npm install`.
   If it does not, keep the override and add a "Dependency notes" section to `README.md` that states the override and why it is safe.
2. Add a `no-restricted-imports` rule in `eslint.config.js` for `src/**` that forbids `openai/helpers/zod` and `openai/helpers/zod.mjs`, with the message "JSON mode output is parsed with the app's own zod schemas (ADR-0003)".

Acceptance: `npm ls zod` shows a single version; `npm run lint` fails on a temporary file in `src/` that imports `openai/helpers/zod`, and passes once the file is removed.

## F3 — Scripts and README as in the sibling app

T01 step 3 says "scripts as in the sibling app plus `eval:extraction`".
`../training-log/package.json` has `format` and `db:generate`, and its `dev` script uses `-k` so both processes stop together.

Steps:

1. Add `"format": "prettier --write ."` and `"db:generate": "drizzle-kit generate"`.
2. Change `dev` to exactly `concurrently -k -n server,client "npm:dev:server" "npm:dev:client"`.
3. Add `"format:check": "prettier --check ."`.
   Leave `lint` as it is.
4. Update the scripts table in `README.md`.

Acceptance: the scripts table in `README.md` lists every script in `package.json`.

## F4 — Required values in `.env.example` must be empty

`APP_PASSWORD` and `SESSION_SECRET` ship with placeholder values that satisfy the length rules in `docs/architecture.md` section 11.
Copying the file without editing would start the app with a known password.

Steps: leave both empty, and comment each with its requirement, as `../training-log/.env.example` does.
Keep every other variable and its default.

Acceptance: `grep -E '^(APP_PASSWORD|SESSION_SECRET)=$' .env.example` prints exactly two lines.

## F5 — Dependency versions: newest stable release, identical in both apps

The reviewed commit pins the newest release inside each major named in section 3.
The policy recorded in F0 asks for the newest stable release overall, so most of the stack moves up one or more majors.
The sibling app has the same instruction, and every shared dependency must end on the same version in both `package.json` files.

Snapshot of `npm outdated` on 2026-09-06, for orientation only; the registry is the source of truth:

| Package | Pinned | Latest |
| --- | --- | --- |
| `vite` | 7.3.6 | 8.2.2 |
| `vitest` | 3.2.7 | 5.0.0 |
| `@vitejs/plugin-react` | 4.7.0 | 6.1.1 |
| `eslint` | 9.39.5 | 10.10.0 |
| `typescript` | 5.9.3 | 7.0.2 |
| `react-router` | 7.18.3 | 8.3.1 |
| `pino` | 9.14.0 | 10.3.1 |
| `openai` | 5.23.2 | 7.10.0 |
| `@types/node` | 22.20.1 | 26.4.1 |

Steps:

1. Read `../training-log/package.json`.
   For every dependency both apps share, pin the version `training-log` has when it is newer than yours; that repository may have gone first.
2. For the rest, run `npm outdated` and apply the section 3 policy package by package: pin the newest stable release, run `npm install`, run the four scripts.
   Move packages that depend on each other in one step: `vite` with `vitest`, `@vitejs/plugin-react` and `@tailwindcss/vite`; `eslint` with `typescript-eslint` and `eslint-plugin-react-hooks`; `typescript` with `typescript-eslint`.
   The peer dependency ranges of the newest `typescript-eslint` and `@tailwindcss/vite` decide how far `typescript`, `eslint` and `vite` can go.
3. `@types/node` follows the Node.js major in `engines`, so it stays on 22.x until an ADR changes the runtime.
   `jsdom` 30.0.1 is newer than the registry's `latest` tag; keep it.
4. For every major that a rule in section 3 stops, write one line in the commit body naming the package, the version taken and the reason.
5. Set `printWidth` to 100 in `.prettierrc`, as in `training-log`, and run `npm run format`.

Acceptance: the four scripts exit 0; every dependency shared with `training-log` has the identical version in both `package.json` files; every package that `npm outdated` still lists is named in the commit body.

## F6 — Repository hygiene: line endings and Prettier scope

Windows checkouts with `core.autocrlf=true` turn the working tree into CRLF, which makes `prettier --check` fail on every file while the index stays LF.
`docs/*.md` also fail `prettier --check` because Prettier reflows Markdown tables; the docs are owned by the architecture work and are not formatted by Prettier.

Steps:

1. Add `.gitattributes` with the single line `* text=auto eol=lf`.
2. Add `.prettierignore` with `docs/`, `eval/receipts/`, `eval/results/`, `dist/`, `data/` and `package-lock.json`.
3. Run `npm run format:check` and fix anything it reports.
4. If `git ls-files --eol | grep 'w/crlf'` prints anything, commit first, confirm `git status --porcelain` is empty, then run `git rm -r --cached . -q && git reset --hard -q` so Git rewrites the working tree with LF.

Acceptance: `git ls-files --eol | grep -v 'i/lf w/lf'` prints nothing, and `npm run format:check` exits 0.

## Done

All four scripts plus `npm run format:check` exit 0.
The body of the branch's last commit carries the script summary, the skipped-major lines from F5, and anything you noticed but did not change.
Then fast-forward merge the branch into `main`, per the `AGENTS.md` rule from F0.
Commit subjects use the `type: subject` form, as the existing commits in this repository do.
