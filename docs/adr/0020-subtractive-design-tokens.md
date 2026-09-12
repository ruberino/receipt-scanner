# ADR-0020: Subtractive design with one set of tokens

- Status: Accepted
- Date: 2026-09-12

## Context

The client grew screen by screen, each task adding what it needed: a bordered card here, a pill badge there, a grey helper line, hand-picked Tailwind sizes (`text-xs`, `text-sm`, `text-lg`) and colours (`gray-600`, `blue-600`, `green-600`) per element.
Together the additions buried the content the household came for, and the pages did not share a left edge, a type scale or a spacing rhythm.
Ruben added the `subtractive-design` skill (`.claude/skills/subtractive-design/SKILL.md`) to the repository and asked for it to be applied.

## Decision

- The skill is normative for every visual change to the client, alongside section 10 of the architecture.
  Its test — remove the element unless the message disappears or the user needs it — is applied while designing, not as a cleanup afterwards.
- Every size and colour comes from the tokens in `src/client/styles.css` (`@theme`): one type ratio (1.25 from a 16 px body) with three sizes in use (`meta`, `body`, `display`), one ground (receipt paper), ink in three strengths, one green accent, one danger and one warning colour.
  Tailwind's default palette and size utilities are not used in the client.
- Layout is one outer margin (`.page`: 20 px, one left axis, `max-w-2xl` centred) and two levels of vertical spacing (8 px within a group, 32 px between groups) on a 4 px base.
  Rows separate by rhythm, not by borders; a border or tint is not used to make something look important.
- Recurring controls are component classes (`.btn`, `.field`, `.eyebrow`, `.meta`, `.chip`, `.link`, `.option`, `.popover`), so a change to a control is one edit.
- Section 10 of the architecture still decides *what* a screen contains.
  Every element it names stays; this ADR decides how it looks.
  Removing a named element (a badge, a note, a chip) is a change to section 10 and a question for the foreman, not a licence the skill grants.

## Consequences

- Page titles are set in a serif display face at 2.44× body, section labels as small uppercase eyebrows, everything else at body or meta size.
- Status badges and kind chips render as small coloured text rather than pills; the warning chips on the receipt page render as lines of warning-coloured text.
  Their content, names and links are unchanged.
- The theme colour in `index.html` and the manifest follows the paper ground.
- A later task that adds a screen uses the component classes and the tokens; a new size or colour is a change to this ADR.

## Alternatives considered

- Keep per-element Tailwind classes and only tidy the worst offenders: rejected — the sizes and colours would keep drifting, one task at a time.
- A component library (shadcn/ui, Radix themes): rejected — a household app with seven screens does not need one, and every library brings its own scale and palette.
- A web font from Google Fonts: rejected — an external request on every load for a PWA that otherwise talks only to its own server; the system serif stack gives the display face enough character.
