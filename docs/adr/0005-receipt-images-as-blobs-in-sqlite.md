# ADR-0005: Store normalised receipt images as BLOBs in SQLite

- Status: Accepted
- Date: 2026-09-05

## Context

The original photo is needed after extraction: to review and correct lines, to retry a failed extraction, and to grow the eval set.
The Render free plan has an ephemeral disk, so files written next to the database disappear on redeploy.
Litestream already replicates the SQLite file to S3.
Volume is small: about one receipt a week, 200–500 KB each after downscaling, roughly 20–30 MB a year.

## Decision

- The server normalises every upload with `sharp`: validate format, apply EXIF rotation, resize so the long edge is at most 2000 px, encode JPEG quality 85.
- The normalised JPEG is stored in a separate `receipt_images` table (`receipt_id`, `mime_type`, `bytes`, `width`, `height`, `sha256`) so listing receipts never loads image bytes.
- `sha256` of the normalised bytes is unique; a duplicate upload returns `409` with the existing receipt id.
- Images are served through `GET /api/receipts/:id/image` behind auth with a one-day private cache header.
- The client also downscales before upload (canvas, 2000 px, JPEG 0.85) to save bandwidth and to convert iPhone HEIC to JPEG; the server step is the guarantee.
- If yearly volume ever exceeds a few hundred megabytes, a new ADR moves images to an S3 prefix; the table design makes that a contained change.

## Consequences

- One backup mechanism covers everything; a restore brings the images back with the data.
- No S3 SDK, no signed URLs, no second credential in the app.
- The database file grows by the image size; SQLite and Litestream handle files far larger than this.
- `sharp` is a native dependency and must be installed in the Docker final stage on the target platform.

## Alternatives considered

- Files on disk under `/data`: lost on every redeploy on the free plan.
- Upload straight to S3 from the app: works, but adds an SDK, credentials in the app and a second thing to back up and clean up.
- Discard the image after extraction: saves space but removes the ability to review, retry and build the eval set.

## Amendment, 2026-09-07 (T28)

Three real Kiwi receipts in Ruben's demo (48–56 lines each) were stored at 149×2000, 149×2000 and 142×2000 px: capping the long edge at 2000 px shrank a tall, narrow receipt strip until the printed digits were a few pixels high, and the model invented quantities, prices and texts instead of reading them (line sums off by roughly 20–50% against the printed totals).
The resize rule in the "Decision" section above is superseded by: resize so the **short** edge is at most 1600 px, never enlarging, with **no cap on the long edge**; JPEG quality 85 is unchanged. The client's own downscale (`downscaleImage.ts`) applies the same short-edge rule, so the phone does not destroy the image before it reaches the server.
A stored image taller than 2000 px is cut into consecutive vertical segments of at most 2000 px, each overlapping the previous one by 120 px, at extraction time only (`segmentImage` in `src/server/lib/images.ts`, called from `extractReceipt.ts`), and sent as multiple `image_url` parts in one request (ADR-0003, ADR-0015); the stored bytes themselves are never re-cut.
This trades a taller stored image (still 200–500 KB range for JPEG, since resolution mostly grows along one axis) for legible digits; see `docs/architecture.md` section 7.1 and `docs/tasks.md` T28.
