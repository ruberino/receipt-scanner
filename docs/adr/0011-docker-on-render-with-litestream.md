# ADR-0011: One Docker container on Render with Litestream replication to S3

- Status: Accepted
- Date: 2026-09-05

## Context

`sissel`, `shopper` and the sibling `training-log` deploy as one Docker container on the Render free plan with Litestream replicating SQLite to an S3-compatible bucket.
The free plan disk is ephemeral, so replication is what makes the data survive deploys and restarts.
This app stores images in the database (ADR-0005), so the replicated file is a few tens of megabytes larger per year than the sibling apps.

## Decision

- Multi-stage `Dockerfile`: build the client on `node:22-alpine`; copy the Litestream binary from `litestream/litestream:0.3.13`; final stage `node:22-alpine` runs `npm ci --omit=dev` so `sharp` gets its `linuxmusl` binary, copies `src`, `drizzle` and `dist/client`, sets `NODE_ENV=production`, `PORT=8080`, `TZ=Europe/Oslo`, `DATABASE_PATH=/data/receipt-scanner.db`.
- `start.sh`: restore with `litestream restore -if-replica-exists` when `LITESTREAM_BUCKET` is set and the file is missing; then `exec litestream replicate -exec "npm start"`; without a bucket, `exec npm start` and a loud warning.
- `litestream.yml` with one database and one S3 replica configured through `LITESTREAM_*` variables, `force-path-style: true`.
- `render.yaml`: one `web` service, `runtime: docker`, `plan: free`, `healthCheckPath: /api/health`, secrets including `MOONSHOT_API_KEY` as `sync: false`.
- Migrations run in-process after the restore (ADR-0010).
- A restore drill is part of the deployment task and is repeated after any change to `start.sh` or `litestream.yml`.
- `GET /api/health` never calls Kimi, so a Kimi outage does not fail the Render health check.
- `GET /api/health` reports `replication: 'on' | 'off'` from whether `LITESTREAM_BUCKET` is configured, the same as the sibling apps.

## Consequences

- Same operational model as the other household apps.
- Cold starts on the free plan are slow; the job runner requeues unfinished receipts on boot, so a scan during a restart is not lost.
- Only one instance may run at a time, which the in-process job runner requires (ADR-0006) and a single Render web service guarantees.
- Replication lag of a few seconds means the most recent scan could be lost if the container dies immediately after; acceptable, the user simply scans again and duplicate detection prevents double entries.

## Alternatives considered

- Render persistent disk: paid, and still needs a backup.
- Fly.io with a volume: viable, but the household apps live on Render.
- Managed Postgres plus S3 for images: more services and credentials for no functional gain.
