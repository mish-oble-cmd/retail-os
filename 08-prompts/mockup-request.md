# Template — Mockup Request

```
Create the mockup for <SCREEN-ID> (<screen name>) from 04-design/screen-inventory.md.

Process:
1. Read 04-design/mockup-guidelines.md, 04-design/design-system.md, and the
   screen's row in screen-inventory.md, plus the FRs it implements
2. Produce a single self-contained HTML file at
   04-design/mockups/<app>--<screen-slug>.html using the design tokens
3. Include: the primary state with realistic data, AND the required edge
   states (empty / offline / error as applicable)
4. Self-check against the review checklist in mockup-guidelines.md and print
   the checklist results
5. Update the mockup status table in screen-inventory.md to "☐ review"

Open questions about layout or content should be asked BEFORE producing the
file only if they change the screen's structure; otherwise make a sensible
call and list your choices at the end for my review.
```

## Variant — revision after review

```
Revise 04-design/mockups/<file> per this feedback: <feedback>.
Keep everything else unchanged. Re-run the review checklist. If any feedback
conflicts with design-system.md, flag it instead of silently diverging —
we either follow the system or update the system.
```

## Variant — approve

```
<SCREEN-ID> is approved. Update its status to "☑ approved" in
screen-inventory.md. This mockup is now the visual contract for implementation.
```
