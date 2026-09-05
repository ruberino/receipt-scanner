# ADR-0009: Shared household password with a signed cookie, no user accounts

- Status: Accepted
- Date: 2026-09-05

## Context

The app is used by one household and exposed on the public internet through Render.
Receipt data and images are private and must not be open to the world, but the household shares one grocery history, so per-person accounts add nothing.
`sissel` and the sibling `training-log` use the same scheme.

## Decision

- One shared password from `APP_PASSWORD`, minimum 8 characters, required in every environment.
- `POST /api/auth/login` compares with `crypto.timingSafeEqual` over SHA-256 digests.
- Cookie `kvitteringer_auth` with value `hex(HMAC-SHA256(SESSION_SECRET, "kvitteringer-v1"))`; `HttpOnly`, `SameSite=Lax`, `Path=/`, one year, `Secure` in production.
- An `onRequest` guard on `/api/*` except `/api/auth/login` and `/api/health`.
- Login rate limited to 5 attempts per minute per IP.
- Receipt images are only reachable under `/api/receipts/:id/image`, so they are behind the guard.
- Rotating `SESSION_SECRET` logs everyone out.

## Consequences

- No user or session tables; a database restore never affects logins.
- All household members see and edit the same data by design.
- Security relies on a strong generated password and the rate limit; both are documented in the README.

## Alternatives considered

- Personal accounts: only needed for per-person data, which is out of scope.
- No auth on a private network: rules out scanning at the store or on mobile data.
- Third-party login: more setup than a household tool warrants.
