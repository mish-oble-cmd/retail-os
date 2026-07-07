# Template — Phase Kickoff

```
We are starting Phase <N> of RetailOS.

Read, in order:
1. CLAUDE.md
2. 05-roadmap/phases-overview.md
3. 05-roadmap/phase-<N>-<name>.md
4. The FRs referenced by this phase in 02-product/feature-requirements.md
5. Relevant sections of 03-architecture/ (list any you'll rely on)

Then, before writing any code:
- Restate the phase goal and the full deliverable list in your own words
- List the mockups required by the phase's mockup gate and their status in
  04-design/screen-inventory.md
- Propose the order of workstreams with a short rationale
- Flag anything underspecified in the docs as explicit questions for me —
  do not fill gaps with assumptions

Wait for my approval of the plan before implementing. We do mockups first
for any screen not yet approved.
```

## Variant — resuming a phase mid-way

```
We are mid-Phase <N>. Read 05-roadmap/phase-<N>-<name>.md and check its
acceptance criteria and the mockup status table in 04-design/screen-inventory.md
against the actual code in apps/ and packages/. Report: done / partially done /
not started per deliverable, with file evidence. Then propose the next single
workstream to tackle.
```
