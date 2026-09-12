# ADR-0020: Subtractive design with one set of tokens

- Status: Accepted
- Date: 2026-09-12

## Context

The client grew screen by screen, each task adding what it needed: a bordered card here, a pill badge there, a grey helper line, hand-picked Tailwind sizes (`text-xs`, `text-sm`, `text-lg`) and colours (`gray-600`, `blue-600`, `green-600`) per element.
Together the additions buried the content the household came for, and the pages did not share a left edge, a type scale or a spacing rhythm.
Ruben added the `subtractive-design` skill (`.claude/skills/subtractive-design/SKILL.md`) to the repository and asked for it to be applied, then gave two brand sheets as the visual direction: flat fields of colour, a confident geometric sans, blue ink on a warm cream ground with one soft accent.

## Decision

- The skill is normative for every visual change to the client, alongside section 10 of the architecture.
  Its test — remove the element unless the message disappears or the user needs it — is applied while designing, not as a cleanup afterwards.
- Every size and colour comes from the tokens in `src/client/styles.css` (`@theme`): one type ratio (1.25 from a 16 px body) with three sizes in use (`meta`, `body`, `display`), a cream ground (`#F1EDE1`), blue ink in three strengths (`#1E3F72`, `#2B5EA9`, `#B9CBE4`), blush (`#EBA9B5`) for the one block that needs the eye, and a brick red (`#AB3730`) kept apart for destructive actions only.
  Tailwind's default palette and size utilities are not used in the client.
- Two self-hosted variable fonts, pinned through npm and declared face by face in `styles.css` so only the latin subset reaches the build: Outfit for display (titles, buttons, eyebrows) and Plus Jakarta Sans for body.
  Rounded display faces were tried first and rejected as too close to Comic Sans.
- Layout is one outer margin (`.page`: 20 px, one left axis, `max-w-2xl` centred) and two levels of vertical spacing (8 px within a group, 32 px between groups) on a 4 px base.
  Rows separate by rhythm, not by borders; a border or tint is not used to make something look important.
- Recurring controls are component classes (`.btn`, `.field`, `.eyebrow`, `.meta`, `.chip`, `.link`, `.option`, `.popover`, `.note`, `.disclosure`), so a change to a control is one edit.
- Section 10 of the architecture still decides *what* a screen contains.
  Every element it names stays; this ADR decides how it looks.
  Removing a named element (a badge, a note, a chip) is a change to section 10 and a question for the foreman, not a licence the skill grants.

## Consequences

- Page titles are set in Outfit at 2.44× body in the accent blue, section labels as small uppercase eyebrows, everything else at body or meta size.
- Buttons are pills: filled blue for the primary action, a two-pixel blue outline for the secondary, plain red text for a destructive one.
- Status badges and kind chips render as small coloured text rather than pills, and the receipt warnings render as one blush block.
  Their content, names and links are unchanged.
- The theme colour in `index.html` and the manifest follows the cream ground.
- Two font files ship, 32 kB and 27 kB, from the app's own origin; no external request and no CDN in the content security policy.
- A later task that adds a screen uses the component classes and the tokens; a new size or colour is a change to this ADR.

## Alternatives considered

- Keep per-element Tailwind classes and only tidy the worst offenders: rejected — the sizes and colours would keep drifting, one task at a time.
- A component library (shadcn/ui, Radix themes): rejected — a household app with seven screens does not need one, and every library brings its own scale and palette.
- Fonts from the Google Fonts CDN: rejected — an external request on every load for a PWA that otherwise talks only to its own server, and a third party learning who opens the app.
- A system font stack with no font files at all: rejected — it renders as a different app on each platform, and neither brand sheet survives the substitution.
- Rounded display faces (Fredoka, Nunito) matching the brand sheets literally: rejected by Ruben on sight as too close to Comic Sans; Outfit keeps the geometric friendliness without the bubble.
