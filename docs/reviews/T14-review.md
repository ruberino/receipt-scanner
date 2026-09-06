# Review follow-up: T14 — Kvitteringer

Review of commit `b295616` (T14) on `task/T14-client-shell`, 2026-09-06.
Verdict: approved for fast-forward merge after F1 and F2, both small.

## What was verified

All five scripts exit 0 on the branch; 320 tests pass; nothing under `src/client` imports from `src/server`; every DOM test file carries the jsdom pragma.
`fetchJson` sets `Content-Type` only with a body, parses the error body into `ApiRequestError`, falls back to a generic error on a non-JSON body, returns `undefined` on 204 and calls `onUnauthorized` on a 401 from every path except login; eight tests.
`uploadFile` posts multipart through `XMLHttpRequest` with a progress callback, maps error bodies to `ApiRequestError` and treats a 401 like `fetchJson` does.
`RequireAuth`, the unauthorized bridge, the four tabs from section 10 with safe-area padding, the positioned toast with the reset-on-call timer, the login page with its three messages and `format.ts` (`3. sep. 2026`, the relative dates, `formatOre` re-exported) all match the task; the Vite proxy bypass is in and was verified against a running dev server.
The App test stubs the global `fetch` instead of the client module, so the real 401 wiring is exercised, including a 401 from a query other than `auth/me`.
The four sibling lessons were verified against the sibling's source before being applied, which is the right way to reuse.
Matching the sibling's relative-date wording is accepted; ADR-0002's "same structure" covers shared microcopy when this app's docs are silent.

## F1 — Required before merge: the two detail routes exist as placeholders

Section 10 lists `/receipts/:id` and `/products/:id`; the shell has only the four tab routes, so a deep link renders nothing inside the shell until T16 and T17 land.
Add placeholder pages for both routes, as the sibling did for `/exercises/:id`, and one App test that `/receipts/42` renders the placeholder when authenticated.

## F2 — Required before merge: `uploadFile` has tests

T15 builds the scan flow on `uploadFile`, and the 409 path with `details.existingReceiptId` decides where the user is sent.
Stub `XMLHttpRequest` with `vi.stubGlobal` and test: progress callbacks receive `loaded / total`; a 202 with a JSON body resolves to the parsed object; a 409 rejects with an `ApiRequestError` carrying `status`, `code` and `details.existingReceiptId`; a 401 calls `onUnauthorized`; a network error rejects with status 0 and the generic message.

## Done

F1 and F2 as one commit on the T14 branch, then fast-forward merge and send the hash.
