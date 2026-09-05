# ADR-0001: Record architecture decisions

- Status: Accepted
- Date: 2026-09-05

## Context

The app will be implemented largely by AI coding agents, possibly smaller models, one task at a time.
This app has more design surface than most household tools: an LLM pipeline, a matching strategy, a suggestion algorithm and image handling.
Each of those invites re-design by an agent that does not know why the current shape was chosen.

## Decision

We record every architecturally significant decision as an ADR in `docs/adr/`, using the template in `docs/adr/README.md`.
A decision is significant when it is expensive to reverse or when it constrains several tasks.
Accepted ADRs are immutable except for their status line.
Changing a decision means writing a new ADR that supersedes the old one.

Implementers must read all ADRs before starting a task and must stop and ask when a task requires a decision no ADR covers.

## Consequences

- Reviewers check a PR against the ADRs instead of re-arguing choices.
- Smaller models get an explicit list of constraints.
- Prompt changes, model changes and algorithm changes get a paper trail and an eval requirement (ADR-0014).

## Alternatives considered

- Only `architecture.md`: describes the result, not the reasoning.
- Decisions in PR descriptions: not discoverable from the repository.
