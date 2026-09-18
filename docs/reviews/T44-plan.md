# T44 plan — Kvitteringer: paste an image on /scan

Foreman's task definition, 2026-09-18, from the follow-up the working session noted while building T42.
Order: after T42 merges. Branch `task/T44-paste-to-scan`, pull request per AGENTS.md, this plan as the first (docs) commit.

## The change in one paragraph

An image on the clipboard — copied from a web page, a screenshot, a file manager — is uploaded by pasting it on `/scan`.
It is the third way into the same door: `enqueueFiles` stays the one entry point, and the clipboard hands back `File` objects like the input and the drop do.

## Decisions

- **The same entry point.** `enqueueFiles`, unchanged. If this task adds a second way to build an entry or a second call to the upload, it is wrong.
- **One listener, on `window`, registered once and removed on unmount**, reaching the current `enqueueFiles` through the ref T42 already put there. `paste` does not need `preventDefault` here: there is nothing on the page that would otherwise receive the image, and taking the event would break pasting into the search fields on other pages if the listener ever leaked.
- **Only files, and only images.** Read `event.clipboardData.files`; ignore a paste with none, so pasting text anywhere on the page does nothing. A paste carrying both an image and something else uploads the image; a paste carrying files but no image says `Bare bilder kan lastes opp`, the same sentence T42 uses, because it is the same rule.
- **A pasted file often has no name.** A screenshot arrives as `image.png` in some browsers and as an empty string in others, and the entries list renders `file.name`. When the name is empty, the row reads `Limt inn bilde`. The name is display only; nothing server-side depends on it.
- **No overlay, no new resting layout.** Nothing on the page changes until something is pasted.
- **Say where it works.** The `/scan` row in section 10 states that pasting works where the browser delivers a clipboard image to the page — desktop browsers and an iPad with a keyboard — and that on an iPhone the share sheet, not the clipboard, is the route. Do not claim the iPhone: a `paste` event on a page with no editable target is not something iOS Safari reliably delivers, and this repository has no way to test it. If Ruben finds it works on his phone, that is a line to add to the docs later, not a claim to ship now.

## Not in this task

- Any change to the drop handling, the overlay, the queue, the downscale or the upload.
- `pointer-events-none` on the T42 overlay. If this work brings you back into that element anyway, do it and say so in the pull request — it was noted in the T42 review as insurance, not as a defect.
- The iPhone share sheet. That is T43 and it is held with Ruben.
- Reading the clipboard on a button press (`navigator.clipboard.read`). It needs a permission prompt and it reads the clipboard without the user pasting; the paste event is the user asking, which is the whole difference.

## Files

`src/client/pages/ScanPage.tsx`, `test/client/ScanPage.test.tsx`, `docs/architecture.md` (the `/scan` row in section 10), `docs/tasks.md`.

## Acceptance criteria

- Pasting one image uploads it, with the same per-file states the input and the drop produce.
- Pasting an image whose name is empty shows the row as `Limt inn bilde` and uploads it.
- Pasting text uploads nothing, shows no toast, and leaves the page untouched.
- Pasting a PDF alone uploads nothing and shows `Bare bilder kan lastes opp`; a PDF together with an image uploads the image and shows the toast once.
- The file input and the drop behave exactly as before, through the same `enqueueFiles`.
- The listener is gone after unmount.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check` pass; no extraction eval.

## Tests

`test/client/ScanPage.test.tsx`: a paste with one image uploads it; an empty name renders `Limt inn bilde`; a paste with text only does nothing; a mixed paste uploads the image and shows one toast; the drop and the input still work; a paste after unmount enqueues nothing, proven the way T42's cleanup test was — once before the unmount and once after.

Show at least one test failing without the implementation and say which in the pull request, and check the cleanup test the same way: a negative assertion that passes without the listener proves nothing.
