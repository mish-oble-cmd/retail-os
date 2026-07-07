# Security & Compliance

Target bar: OWASP ASVS Level 2 (NFR-4). Money software earns trust or dies.

## Threat model (top risks, POS-specific)

| Threat                                             | Mitigation                                                                                                                                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stolen/lost POS device with local data             | Encrypted SQLite (SQLCipher / OS keystore), device tokens revocable from admin (kill switch → device wipes local DB on next contact and refuses PIN login when told), auto-lock, no card data ever stored |
| Insider fraud (voids, fake refunds, sweethearting) | Role limits (FR-5.2), manager PIN escalation, immutable audit log (FR-5.3), over/short tracking per shift, anomaly reports (refund rate per staff)                                                        |
| Tenant data leakage (multi-tenancy bug)            | `store_id` enforced in ORM query wrapper (impossible to build an unscoped query without an explicit `dangerouslyCrossTenant` call), Postgres RLS as second layer, tenant-isolation tests in CI            |
| Credential stuffing on admin                       | Argon2id hashes, rate limiting + lockout, mandatory 2FA offer (mandatory for Owner role), breached-password check                                                                                         |
| Webhook/API abuse                                  | Scoped keys, HMAC signatures, rate limits, replay windows                                                                                                                                                 |
| Sync forgery (fake sales injection)                | Device tokens bound to register, batch signatures, server-side revalidation of all totals via domain package                                                                                              |
| Supply-chain (npm)                                 | Lockfiles, renovate + review, `pnpm audit` in CI, minimal dependency policy for `domain`/`sync` (near-zero deps)                                                                                          |

## Payment card data (PCI DSS)

**Design goal: SAQ-A-level scope.** We never see, transmit, or store PANs:

- Integrated payments via processor SDKs/terminals (Stripe Terminal etc.) — card data flows device→processor
- "Manual card" tender stores only last4 + reference typed by cashier (documented as non-sensitive reference, never full PAN — validation rejects >4 digits patterns)
- No card data in logs, receipts show masked info only

## Data protection & privacy

- At rest: cloud DB encryption, encrypted local SQLite, S3 SSE
- In transit: TLS 1.2+ everywhere including sync; cert pinning on mobile (consider)
- PII inventory: customers (name/phone/email/address), staff. Provide export + delete (anonymize orders, keep financial facts) for GDPR-style requests
- Data residency: single region v1; architecture keeps store data separable (per-store export) for future regional hosting
- Backups: PITR on Postgres, daily snapshots, quarterly restore drills

## Regional fiscal compliance (launch-market module)

Receipt/fiscal rules vary hard by country (e.g., Philippines BIR-accredited receipts with serial ranges & "This serves as your official receipt" wording, EU fiscal printers, Kenya eTIMS). Design: **`ComplianceProfile` per store** that customizes receipt fields, numbering rules, and export reports. Phase 1 ships a generic profile + the first launch-market profile; others are additive. Never hardcode one country's rules in core.

## Application security practices

- Authz: permission checks in module services (not just controllers); staff PIN actions logged with register+staff attribution
- Input validation at the edge (zod schemas shared with clients where useful)
- Secrets: no secrets in repo; use platform secret manager
- Sessions: httpOnly SameSite cookies (admin), short-lived JWTs + rotating refresh (devices)
- Audit: security-relevant events append-only, exportable
- Dependency & container scanning in CI; `security-review` pass before each phase release
- Disclosure: security.txt + contact from first public release

## Compliance roadmap

| When    | Item                                                                           |
| ------- | ------------------------------------------------------------------------------ |
| Phase 1 | ASVS L2 self-assessment checklist in CI templates; tenant-isolation test suite |
| Phase 4 | PCI SAQ-A attestation with processor integration                               |
| Post-v1 | SOC 2 Type I → II when chasing chains/mid-market                               |
