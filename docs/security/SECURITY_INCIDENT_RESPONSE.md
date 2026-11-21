# Incident response

1. **Contain** — use the narrowest stop that covers the incident: business pause (business admin), organization stop (Organization page, org admin) or platform stop (owner center, Platform Owner with code). Stops need a reason, are audited and do not lift each other. Work already accepted by an outside service cannot be called back.
2. **Accounts** — affected users sign out other devices (Settings → Sign-in) and reset their password; admins remove members or lower roles (audited by the database).
3. **Evidence** — owner center → Security: verify the audit chain and note the head fingerprint; review refused-access counts, repeated refusals and credit spikes. Export audit rows before any cleanup; audit rows cannot be deleted.
4. **Credits** — refunds only through the role-checked credit functions; never edit ledgers.
5. **Recover** — lift the stop tier that was set, re-run the SQL suites and Vitest, record what happened in the audit log (the stop reason) and in `docs/SECURITY.md`.

Out of scope: failed sign-in monitoring (handled by the auth service), automated alerts (no background monitoring exists).
