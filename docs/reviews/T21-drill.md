# Restore drill — Kvitteringer

Date: 2026-09-07 (host local time; container logs are UTC, stamped 22:31 on 2026-09-06 = 00:31 in Oslo).
Run against a local MinIO via `docker-compose.drill.yml`, not the real bucket.
No receipt was scanned: per the plan, the drill proves replication and restore, not extraction, so `MOONSHOT_API_KEY` is a dummy value and both receipts stay at status `uploaded` (T24), which already has its row and image bytes without a scan.

## Sequence and result

1. `docker compose -f docker-compose.drill.yml up --build -d` — MinIO healthy, `createbucket` created `local/receipt-scanner-drill`, app started with `LITESTREAM_BUCKET=receipt-scanner-drill` pointed at `http://minio:9000`.
2. Logged in (`drill-password-123`), uploaded two receipt photos (`POST /api/receipts`, ids 1 and 2, both `status: uploaded`), created one product (`POST /api/products`, "Drill Lettmelk 1 l", id 1), created a shopping list (`POST /api/shopping-lists`, id 1) and added one manual item (`POST /api/shopping-lists/1/items`, "Drill handlenett").
3. Confirmed Litestream wrote a snapshot and WAL segments to the MinIO replica after each write (`msg="wal segment written"` in the app logs, one per write: the two uploads, the product, the list, the item).
4. Recorded the sha256 of both receipts' `GET /api/receipts/:id/image` bytes before the drill.
5. `docker compose -f docker-compose.drill.yml down`, then `docker volume rm receipt-scanner_app-data` — deletes the app's local SQLite file entirely, simulating Render's ephemeral disk. The MinIO volume (the replica) was left in place.
6. `docker compose -f docker-compose.drill.yml up -d` on the now-empty app volume.

## Evidence

Restore ran before the app started listening:

```
time=2026-09-06T22:31:48.321Z level=INFO msg="restoring snapshot" db=/data/receipt-scanner.db replica=s3 generation=3bb4ad46e164aee1 index=0 path=/data/receipt-scanner.db.tmp
time=2026-09-06T22:31:48.326Z level=INFO msg="restoring wal files" db=/data/receipt-scanner.db replica=s3 generation=3bb4ad46e164aee1 index_min=0 index_max=0
time=2026-09-06T22:31:48.342Z level=INFO msg="downloaded wal" db=/data/receipt-scanner.db replica=s3 generation=3bb4ad46e164aee1 index=0 elapsed=16.207987ms
time=2026-09-06T22:31:48.347Z level=INFO msg="applied wal" db=/data/receipt-scanner.db replica=s3 generation=3bb4ad46e164aee1 index=0 elapsed=4.774585ms
time=2026-09-06T22:31:48.347Z level=INFO msg="renaming database from temporary location" db=/data/receipt-scanner.db replica=s3
time=2026-09-06T22:31:48.364Z level=INFO msg=litestream version=v0.3.13
time=2026-09-06T22:31:48.364Z level=INFO msg="initialized db" path=/data/receipt-scanner.db
time=2026-09-06T22:31:48.364Z level=INFO msg="replicating to" name=s3 type=s3 sync-interval=1s bucket=receipt-scanner-drill path="" region="" endpoint=http://minio:9000
```

`GET /api/health` after restart:

```json
{ "status": "ok", "version": "0.1.0", "queueLength": 0, "replication": "on" }
```

`GET /api/receipts` after restart — both receipts back, still `uploaded`:

```json
[
  { "id": 2, "status": "uploaded", "storeName": null, "purchasedAt": null, "totalOre": null, "lineCount": 0, "warnings": [], "errorMessage": null, "possibleDuplicateOf": null, "reviewedAt": null, "createdAt": "2026-09-06T22:30:50.697Z" },
  { "id": 1, "status": "uploaded", "storeName": null, "purchasedAt": null, "totalOre": null, "lineCount": 0, "warnings": [], "errorMessage": null, "possibleDuplicateOf": null, "reviewedAt": null, "createdAt": "2026-09-06T22:30:50.642Z" }
]
```

`GET /api/receipts/:id/image` after restart — sha256 of both images identical to before the drill:

```
a14c8da9a06f572bd61ec541ed3455a2051aaabd6ac54a022856ba205bf2b736  receipt 1 (before and after)
4681ef3cc42b7ddad3e050bd53532046d7a41a62e378bc55cc4a745878d96606  receipt 2 (before and after)
```

`GET /api/products/1` and `GET /api/shopping-lists/current` after restart — the product and the list with its item survived:

```json
{ "id": 1, "name": "Drill Lettmelk 1 l", "category": "Meieri", "suppressed": false, "timesBought": 0, "lastBought": null, "medianIntervalDays": null, "aliases": [], "purchases": [] }
```

```json
{
  "id": 1,
  "weekStart": "2026-09-07",
  "status": "open",
  "createdAt": "2026-09-06T22:30:58.230Z",
  "completedAt": null,
  "items": [
    { "id": 1, "productId": null, "name": "Drill handlenett", "quantityText": null, "source": "manual", "reason": null, "checked": false, "position": 1 }
  ]
}
```

**Row count recovered: 2 receipts (with matching image bytes), 1 product, 1 shopping list with 1 item.** Exactly what was created before the drill, nothing more, nothing less.

## Outcome

Restore works as designed, and a restored database migrates cleanly on boot (`runMigrations` with foreign keys off runs on every boot, ADR-0010; the restored file already carried the current schema, so this run didn't exercise a migration from an older one, but the same boot path applies regardless).
`docker compose -f docker-compose.drill.yml down -v` removed both volumes afterward; nothing left running.
