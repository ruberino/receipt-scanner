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
