# Review follow-up: T04 — Kvitteringer

Review of commits `d4ba291` (auth plugin) and `a6ddcf1` (docs) on `task/T04-auth`, 2026-09-06.
Verdict: approved for fast-forward merge, no follow-up items.

## What was verified

All five scripts (`lint`, `typecheck`, `test`, `build`, `format:check`) exit 0 on the branch; 104 tests pass.
The plugin follows ADR-0009 point by point: `timingSafeEqual` over SHA-256 digests, cookie `kvitteringer_auth` with `hex(HMAC-SHA256(SESSION_SECRET, "kvitteringer-v1"))`, `HttpOnly`, `SameSite=Lax`, `Path=/`, one year, `Secure` only in production, guard exempting exactly `/api/auth/login` and `/api/health`, login rate limited to 5 per minute with `global: false`.
`loginSchema` is strict with `password` bounded to 1–200 characters, and the four validation cases are tested.
The 429 path reuses `RateLimitedError` through `appErrorFromHttpError`, and the test asserts the Norwegian message.
The guard-before-routing behaviour is tested both ways (401 without a cookie, 404 with one) and recorded in `docs/architecture.md` section 11; the two `AGENTS.md` conventions landed in a separate `docs:` commit.
`fastify-plugin` 6.0.0 is the newest release.
Existing error tests that hit `/api/*` routes now log in first, which the guard makes necessary.

## Note for T14

Logout is behind the guard, as ADR-0009 lists only login and health as exempt.
A client whose cookie is already invalid gets `401` from logout; the client shell in T14 treats that as logged out.
