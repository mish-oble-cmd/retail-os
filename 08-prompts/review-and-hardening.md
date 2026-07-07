# Template — Phase Exit Review & Hardening

```
Phase <N> implementation is believed complete. Run the exit review:

1. Acceptance audit: go through every acceptance criterion in
   05-roadmap/phase-<N>-<name>.md and every standing exit criterion in
   phases-overview.md. For each: pass / fail / untestable, with evidence
   (file paths, test names, or a manual step for me to perform)
2. Test health: run the full suite; report coverage on packages/domain
   (target ≥90%) and list any skipped/flaky tests
3. Security pass: review the phase's diff against
   03-architecture/security-and-compliance.md (tenancy, authz on new
   endpoints, audit-log coverage, secrets, input validation). Run /security-review
   if available
4. Offline audit (if POS was touched): list every new user action and its
   offline behavior; confirm the offline e2e covers the new paths
5. Docs sync: list every decision made during this phase that is not yet
   reflected in 01–07 docs, and update those docs
6. Produce the demo script I should perform by hand, in order, with
   expected results

Output a single report. Do not fix issues silently — list them, we'll
prioritize together.
```
