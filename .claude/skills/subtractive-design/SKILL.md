---
name: subtractive-design
description: "Apply when designing any visual output — UI, artifacts, mockups, slides, dashboards, widgets, pages. Strips decoration, forces real type hierarchy, clean alignment and even optical rhythm, and prevents neutral, over-built design."
---

# Subtractive design

Default failure mode to correct: **over-building**. Adding a frame, a label, a date, a helper
text, a badge — each feels harmless, and together they bury the thing the user came for.
This skill is the counterweight. Apply it while designing, not as a cleanup pass afterwards.

## The test

For every element, before adding it and again on the finished design:

> «Hvis jeg fjerner dette, vil budskapet forsvinne, eller er det nødvendig for brukeren å ha det?»
> *If I remove this, does the message disappear — or does the user actually need it?*

No to both → remove it. The burden of proof is on keeping, not on cutting.

Example: the user needs to add something, so an **Add** button is necessary. A date beside it?
A frame around it? A line of text explaining what the button does? Almost certainly not.

## 1. Remove decoration («pynting»)

Things that are decoration far more often than not:

- A frame, card or border around content that spacing already groups
- A card inside a card — nesting is almost always flattening waiting to happen
- Helper text under a self-explanatory control
- Icon *and* label *and* tooltip all saying the same thing
- Metadata nobody asked for: dates, IDs, counts, "last updated", "3 items"
- Dashed outlines and skeleton rows for empty states
- A section heading over a section with one obvious kind of content
- Overflow «...» menus, filters and toolbars that hold nothing yet
- Badges, pills, dots and dividers that distinguish nothing from nothing

**Chrome must not outweigh content.** If the empty state has more UI than the filled state has
content, the design is wrong. Build the filled state first; let the empty state be almost nothing.

## 2. Widen the size gap — *typographic scale*

Hierarchy comes from **size**, not from boxes, borders and background tints.

- Pick **one ratio** and derive every size from it: 1.25 (minor third), 1.333 (perfect fourth),
  1.5, 1.618 (golden). Never hand-pick a pixel value per element
- A heading one step above body — 1.2–1.3× — reads as an accident, not a hierarchy. **Skip steps.**
  On a focused surface (a card, a widget, a slide, a hero) the primary heading should land around
  **2.5–4× body**: four steps of 1.333 is 3.16×, three steps of 1.5 is 3.38×
- Two or three sizes in use, total. A scale with ten steps does not mean a design that uses ten
- Weight is part of the scale: pair the size jump with a real weight jump, not a half-step
- If you are reaching for a border or a tinted panel to make something feel important:
  take another step up the scale instead, and drop the border

## 3. Do not be neutral

Minimal is not grey. A design that made no choices is a design that failed — being boring is
as much a failure as being cluttered.

- Commit to a real ground colour, not white with a hint of something
- Commit to a typeface with character, and to a real weight contrast within it
- Illustration over another row of generic icons
- If you would describe the palette as "safe" or "clean", push it further

## 4. Align to shared axes — *grid system*

Once decoration is gone, alignment is what holds the layout together. There is no card edge left
to hide a ragged left edge behind.

- Define the grid before placing anything: outer margin, columns, gutters. Elements start and end
  on column edges — horizontally *and* vertically
- **The fewer axes, the better.** One left edge per column: heading, body, list items and any
  trailing block all start on the same axis unless there is a deliberate reason not to
- The commonest slip: a heading indented a few pixels differently from the list under it. A small
  misalignment does not read as a choice, it reads as sloppiness. Align exactly, or offset enough
  that it is obviously intentional
- Items in a row share a baseline or a centre line — not approximately
- Optical exceptions are real: large type, quote marks and bullets overhang their box and need a
  small negative offset to *look* aligned. Align the ink, not the bounding box

## 5. Make the rhythm feel even — *baseline grid*

The air between lines and blocks should be **perceived** as equal across the whole page.

- Set a base unit (4 or 8 px is the usual choice). Line-heights and every vertical gap are multiples
  of it, so text in different blocks and columns lands on the same baselines
- Then **override it optically.** The grid is the scaffolding, the eye is the judge: equal margins
  routinely look unequal, because line-height, cap height, descenders and struck-through text change
  how much ink sits near the edge. Visually equal beats mathematically equal, every time
- Gaps inside a group: equal. Gap between groups: clearly larger, and consistent between groups.
  Two levels of spacing is usually enough
- A gap that is *almost* the same as its neighbour is the worst case — it reads as a mistake.
  Either make it match, or make the difference obvious
- Check by squinting, or zooming out until the text is unreadable. Uneven rhythm survives the blur;
  that is the test

## Order of work

Grid first, then the type scale, then the optical pass. Placing elements before the grid exists is
what produces the ragged result that no amount of later nudging fixes.

## The trade

Removing decoration buys space. **Spend it on amplifying what remains — never on more elements.**
Subtraction alone gives bland. Subtraction plus amplification is the point. Rules 1 and 3 are
one move, not two — and rules 4 and 5 are what stop the stripped-down result from looking unfinished.

## Worked example

A daily to-do card, in two passes.

**Pass 1 — strip and amplify.** Before: neutral beige card, small-caps date eyebrow, "Good morning,
Kim" at barely above body size, an info button, a nested card labelled "Today's three" with a «...»
menu and three dashed placeholder rows with numbered circles, then a third card holding a dated
quote, then three decorative dots. Almost every pixel is chrome around content that does not exist
yet, and the date appears twice. After: a saturated ground, "GOOD AFTERNOON, KIM" set huge and bold
across three lines, the actual tasks as plain lines with the done ones struck through. No cards, no
dashes, no numbers, no section label, no menu, no date, no quote block.

**Pass 2 — align and even out.** The stripped version still looked wrong, and the reasons were
mechanical: the heading's left edge sat a few pixels off the list's left edge, and the vertical gaps
were all slightly different — a large arbitrary drop under the heading, then uneven gaps between the
three tasks. Fix: every block on one left axis, one consistent gap between tasks, one larger gap
separating the heading block from the list. Nothing was added or removed in this pass. It is the
difference between a design that looks deliberate and one that looks unfinished.

## Before shipping

- Every element that carries no information: removed?
- Do all type sizes come from one ratio, and does the primary heading skip steps to ~2.5×+ body?
- Any card inside a card? Flatten it
- Any border or tint doing a job that size should do? Swap it
- Does the empty state have more UI than the filled state has content?
- Would you call the palette "safe"? Then commit harder
- Does every block start on the same left axis? Any *almost*-alignment?
- Squint: do the gaps read as even within groups, and clearly larger between them?
