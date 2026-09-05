# ADR-0006: In-process job runner with persisted receipt status

- Status: Accepted
- Date: 2026-09-05

## Context

Extraction takes 10–40 seconds and calls an external API, so it cannot run inside the upload request.
There is exactly one server instance and roughly one receipt a week.
A queue service or a worker process would be more infrastructure than the workload justifies, but a crash in the middle of a job must not leave a receipt stuck forever.

## Decision

- Upload stores the image and a receipt with `status = 'pending'`, replies `202`, and pushes the id onto an in-memory FIFO queue in the same process.
- One worker loop processes the queue with concurrency 1.
  It sets `processing`, increments `attempts`, runs extraction and matching, and sets `done`; any error sets `failed` with a short Norwegian `error_message` and a full error log line.
- Status lives in the database, never only in memory.
  On startup `requeueUnfinished()` enqueues every `pending` and `processing` receipt, which turns a crash into a retry.
- The client learns progress by polling `GET /api/receipts/:id` every two seconds while the status is `pending` or `processing`.
- `POST /api/receipts/:id/retry` moves a `failed` receipt back to `pending` and enqueues it; there is no automatic retry beyond the SDK HTTP retries.
- `GET /api/health` reports `queueLength` for visibility.

## Consequences

- No extra process, service or dependency.
- A deploy during a job means the job restarts on boot; saving an extraction replaces any lines written by the interrupted attempt, so a retry never duplicates data.
- Concurrency 1 means a burst of ten scans processes sequentially; at one receipt a week this is irrelevant.
- If the app ever runs more than one instance, this design must be replaced (a database-backed claim with a lease would be the next step).

## Alternatives considered

- Synchronous extraction in the upload request: 40 second requests time out on mobile and on the Render proxy.
- BullMQ or similar with Redis: a paid service and a worker process for one job a week.
- Cron-style polling of the database: simpler than a queue, but adds latency and a timer; the in-memory queue plus startup requeue gives immediate processing and crash safety.
