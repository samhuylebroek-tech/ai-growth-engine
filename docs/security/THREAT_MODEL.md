# Threat model (STRIDE summary)

| Threat | Example | Control | Residual risk |
| --- | --- | --- | --- |
| Spoofing | Org admin calls owner functions | Exact platform role + `aal2` in server function and SQL (`session_mfa_verified`) | Stolen password **and** authenticator device |
| Tampering | Edit/delete audit rows | Append-only triggers + hash chain + owner verification | A database superuser can rebuild the chain; compare the published head fingerprint |
| Tampering | Move a record to another workspace | Immutable tenant columns, composite foreign keys, scope triggers | — |
| Repudiation | "I didn't change that role" | Trigger-based audit with actor from the verified session | Pre-0088 rows are unchained |
| Information disclosure | Read another tenant's data | RLS, restrictive workspace policies, storage path policies, rollback tests | — |
| Information disclosure | SSRF via SEO check | Only registered business website/competitors; public hosts; same-host sitemaps; redirect checks | Members can register competitor websites, so a member can make the server fetch any *public* site once registered |
| Denial of service | Credit burn / flood | Credit reservations, parallel-run caps, monthly plan credits, emergency stops | No per-minute rate limits (documented decision) |
| Elevation of privilege | Self-promotion to owner/admin | Role guards, no user insert into `platform_roles`, owner role not grantable by update | — |
| Prompt injection | Document tells AI to act | Untrusted quoting; AI can only create pending approvals for registered capabilities | AI text quality itself |
