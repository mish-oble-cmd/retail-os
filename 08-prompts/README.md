# Prompt Templates for Claude AI

Copy-paste starters for driving each stage of the project with Claude (Claude Code or claude.ai). They all assume Claude can read this repo — the prompts point at docs instead of restating them, which keeps the docs as the single source of truth.

## Usage pattern

1. Open a session in the repo root (Claude Code reads `CLAUDE.md` automatically)
2. Paste the relevant template, filling `<placeholders>`
3. Insist on the sequence: **restate scope → mockups (if UI) → plan → implement → test → demo checklist**
4. When Claude proposes a decision not covered by docs: approve/adjust, then have it **write the decision into the right doc in the same PR**

## Templates in this folder

| File | Use when |
|---|---|
| `phase-kickoff.md` | Starting any phase |
| `mockup-request.md` | Producing/revising a screen mockup |
| `feature-implementation.md` | Building one workstream/feature inside a phase |
| `review-and-hardening.md` | Phase exit: tests, security, docs sync |

## Session hygiene tips

- One workstream per session; long sessions drift
- Start sessions with: "Read `05-roadmap/phase-N-*.md` and tell me what remains" — keeps the checklist authoritative, not chat memory
- Keep phase checklists updated in the docs (Claude should tick them via edits, so progress survives sessions)
- If Claude builds something out of scope, point at CLAUDE.md rule 2 and have it removed — cheap now, expensive later
