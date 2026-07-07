# Template — Feature / Workstream Implementation

```
Implement workstream <N-X> "<name>" from 05-roadmap/phase-<N>-<name>.md.

Constraints:
- FRs: <list, e.g. FR-1.7, FR-6.1> — acceptance criteria in the phase doc
- Approved mockups: 04-design/mockups/<files> are the visual contract
- Architecture: follow 03-architecture/system-architecture.md module
  boundaries and 03-architecture/data-model.md; business math ONLY in
  packages/domain (it must run offline)
- For POS features: state explicitly how it behaves offline before coding
  (per 03-architecture/offline-sync-strategy.md)
- Standards: 07-development/coding-standards.md; tests per
  07-development/testing-strategy.md (domain changes need golden/property
  tests; fact-creating endpoints need idempotency replay tests)

Process:
1. Short implementation plan: files to create/change, schema/API changes,
   test plan. Wait for my go
2. If a schema or API change is needed, update
   03-architecture/data-model.md / apps/api/openapi/v1.yaml first
3. Implement, then run the full checks (typecheck, lint, tests) and show results
4. Finish with: how to demo this by hand, and tick any phase checklist items
   you completed (edit the phase doc)
```

## Variant — bugfix

```
Bug: <description, repro steps, expected vs actual>.
Find the root cause before changing code and explain it. Add a regression
test that fails first. If it's a P0 per 07-development/testing-strategy.md
(money wrong / data loss / tenant leak), also write a short postmortem note
appended to the relevant architecture doc.
```
