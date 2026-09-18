# T42 plan — Kvitteringer: drop an image on /scan

Foreman's task definition, 2026-09-18, from Ruben's request while the design branch was open: drag-and-drop of images on `/scan`.
The working session's draft was the raw material; the shape below is what it is built to.
Order: first of the two Ruben asked for. Branch `task/T42-drop-to-scan`, pull request per AGENTS.md, this plan as the first (docs) commit.

## The change in one paragraph

An image dragged onto the page from the file manager, the desktop or another window is uploaded exactly as one chosen through `Velg fra bilder`.
There is no second upload path: `dataTransfer.files` hands back the same `File` objects the input does, so the dropped files enter the existing queue, the existing downscale and the existing `POST /api/receipts`.
Nothing server-side, nothing in the resting layout.

## Decisions

- **One entry point.** Pull the body of `handleFilesSelected` into `enqueueFiles(files: File[])` — the entries, the ids, `queueRef` and `processNext` unchanged — and have both the input handler and the drop handler call it. If the drop path grows its own copy of that logic, the task is wrong.
- **The window, not a box.** Listen on `window` for `dragenter`, `dragover`, `dragleave` and `drop`, so a drop anywhere on the page counts. `dragover` must `preventDefault()` or the browser opens the file and navigates away from the app.
- **Only when files are coming.** A drag whose `dataTransfer.types` does not contain `Files` leaves the page alone; dragging selected text must not arm it. `dragenter` and `dragleave` fire for every element the pointer crosses, so a depth counter decides when the drag has really left the window.
- **No stale closure.** The listeners are registered once on mount and removed on unmount; they reach the current render's `enqueueFiles` through a ref. A drop after the page has been left must not enqueue into a page that is gone.
- **The overlay exists only while dragging.** A `fixed inset-0` overlay on the cream ground with `Slipp bildene her` at display size, every size and colour from the tokens in `styles.css` (ADR-0020). It is not in the DOM when nothing is being dragged — this is a phone app first, and an invisible full-screen element that can swallow a tap is a worse bug than the one this task fixes.
- **Non-images are dropped, not uploaded.** Files whose `type` does not start with `image/` are left out; when at least one was, one toast: `Bare bilder kan lastes opp`. The images in the same drop still upload, in the order they were dropped.

## Not in this task

- Pasting an image from the clipboard. It falls out of the same `enqueueFiles` and it is the useful sibling on a phone, where there is no drag-and-drop at all — its own task, noted as a follow-up in the pull request.
- The iPhone share sheet. That is T43 and it is held; see the note at the end of `docs/tasks.md`.
- HEIC. An iPhone photo is `image/heic`, passes the filter and then meets whatever `downscaleImage` makes of it — exactly as it does today through the file input. Same behaviour, not a regression, not this task.
- Any change to the queue, the per-file states, the downscale or the upload.

## Files

`src/client/pages/ScanPage.tsx`, `test/client/ScanPage.test.tsx`, `docs/architecture.md` (the `/scan` row in section 10), `docs/tasks.md`.

## Acceptance criteria

- Dropping two images uploads both, in the order dropped, with the same per-file states the file input produces.
- Choosing files through `Ta bilde` and `Velg fra bilder` behaves exactly as before, through the same `enqueueFiles`.
- Dropping a PDF alone uploads nothing and shows `Bare bilder kan lastes opp`; a PDF together with an image uploads the image and shows the same toast once.
- The overlay appears on a `dragenter` carrying files, survives the pointer crossing child elements, and is gone after a `dragleave` off the window and after a drop.
- A `dragenter` without `Files` in `dataTransfer.types` leaves the page untouched.
- With nothing being dragged, the page renders exactly as before and the overlay is absent from the DOM, not merely transparent.
- The listeners are gone after unmount.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check` pass; no extraction eval.

## Tests

`test/client/ScanPage.test.tsx`: a drop with two image files uploads both in order; a drop with a non-image uploads only the images and shows the toast; the file input still uploads after the refactor; the overlay appears on `dragenter` with files and is gone after `dragleave` and after `drop`; a `dragenter` without `Files` shows nothing; unmounting removes the listeners (a drop after unmount enqueues nothing).

Prove at least one of these fails without the implementation before you push, as in T41, and say which in the pull request.
