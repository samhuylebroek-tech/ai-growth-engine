# Extending AI Growth OS

- **New capability**: add `defineCapability({...})` to `src/lib/registry/capabilities.ts`. External writes must set `requiresApproval: true` (enforced at load).
- **New agent**: add `defineAgent` to `src/lib/registry/agents.ts`, listing capability keys.
- **New connector**: add `defineConnector` to `src/lib/registry/connectors.ts`; store per-org state in `connector_connections`; secrets go to Cloud secrets, never the DB.
- **New module**: add `defineExtension` to `src/lib/registry/extensions.ts`; per-workspace enablement in `workspace_extensions`.
- **New AI provider**: implement `AIProvider` in `src/lib/ai/provider.server.ts` and select it in `getProvider()`.
- **New plan feature**: insert a `plan_entitlements` row per plan and check it server-side before use.
