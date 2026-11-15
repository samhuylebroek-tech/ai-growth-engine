# AI Growth Engine — product remake report
Date: 2026-11-15. Status: broad frontend remake delivered; full product-completion definition is not yet satisfied.

## 1. Previous experience and problems
The previous shell exposed eleven individual tools in five expandable groups. Growth Officer, approvals, activity and knowledge were separate destinations without enough contextual linkage. Home mixed credit/fact counters, next moves and long raw AI summaries, while customer work still required choosing the appropriate tool. Settings mixed workspace administration, invitations, team and organization creation in one long page. The AI page hid conversation history on phones and provided little visible business context or result handling. Several directories were lists of planned features rather than business-oriented working areas.

## 2. New product architecture and navigation
Six primary destinations organize daily work; contextual tabs expose secondary destinations only in their relevant area:

| Primary | Contextual destinations |
| --- | --- |
| Home | Business brief, priorities, direct question, recent work |
| Growth Officer | Conversations and Specialists |
| Growth intelligence | Confirmed context, objectives, hypotheses, recommendations; Growth areas |
| Work & approvals | Review queue and Activity & results |
| Knowledge | Business knowledge and Documents |
| Settings | Organization & team, Data sources, Plan & credits |

Settings itself has Workspaces, Team, Organization and Sign-in tabs. Global search also offers quick actions. Existing public/customer URLs are retained; `/app/intelligence` is new. No empty standalone CRM/marketing/SEO dashboards were created merely to fill navigation.

## 3. Home command center
- Workspace/organization context, a concise business brief drawn only from verified facts, evidence status and actual credit balance.
- Prominent Growth Officer question and starter tasks. A question is transferred to the scoped AI composer for explicit submission; clicking a starter does not silently spend credits.
- Relevant next moves: incomplete profile, unconfirmed claims, failed documents and actual pending approvals. Dashboard review links lead to the existing authorized decision workflow; no bypass of policy checks.
- Confirmed context, objectives and business measurement availability. No scores, forecasts, revenue charts or growth metrics are invented.
- Recent recorded AI work, with long raw summaries replaced by concise entries. Full recorded summaries remain available in Activity.
- Local display preferences for activity/performance; no tenant data is persisted for customization.

## 4. Redesigned workflows
- **Growth Officer:** saved conversation history on desktop and phone; explicit context pane; missing evidence; related knowledge/documents/approvals; retry states; result copy and complete Markdown conversation export. Results remain in the existing conversation store. No separate editable plan/result entity or specialized-agent orchestration was introduced.
- **Growth intelligence:** verified knowledge, configured objectives, saved opportunity hypotheses and pending recommendations, using one scoped summary query shared with Home.
- **Growth areas:** strategy, marketing, sales/customers, website/conversion and analytics grouped by business purpose. Available conversation/research paths work; planned execution remains clearly distinguished.
- **Specialists:** implemented specialist entry actions and honest planned-agent status; capability records adapt to phones.
- **Knowledge:** searchable confirmed/unconfirmed records, source information and existing edit/confirmation controls; profile mirrors are identified separately from trusted facts.
- **Documents:** search, direct review-of-extracted-knowledge link and actionable first upload. Existing quota, private storage, download and extraction remain.
- **Work:** compact review queue, policies shown on demand; searchable/filterable activity with expandable recorded summaries.
- **Settings:** separate tasks for workspaces/access, team, organization and sign-in availability. Microsoft/OIDC controls remain, SAML remains unconfigured.
- **Plan & credits:** unframed actual plan/credit/usage measures and explicit loading/error states; existing ledger/refunds and indicative prices retained.
- **Onboarding:** clearer discovery → confirmation → direction steps and return to personalized Home after the atomic profile save. No automatic new strategy generation or paid discovery was performed for this UI change.
- **Public entrance/auth:** consistent name, typography and colors, a new generated photographic entrance and intact sign-in/recovery controls. The image is illustrative, not a claim about a customer's office.

## 5. Existing foundation preserved
No schema migrations, data resets, customer-data removal, role grants, hosted auth-setting changes or AI-provider changes occurred. Existing tenant/workspace RLS, immutable identities, role caps, invitation/seat functions, approval policies, reservations/settlement/refunds, subscriptions, audit records, registries and private storage are preserved. Message reads first check their parent conversation against organization/workspace/user scope because message rows have no workspace column. Existing metered AI server function is reused. Offline caching behavior is unchanged; manifest/offline branding updated only.

## 6. Fresh verification and exact outcomes
- **74 automated tests passed across 7 files:** 59 previous tests, 3 new organization/workspace draft-isolation tests, and 12 actual navigation destination checks. No SQL tests were rerun in this frontend-only turn; the earlier 119 checks are historical evidence, not fresh results.
- Signed-in real Home → question transfer → Growth Officer provider answer → persisted conversation → reload/reopen succeeded. The response identified Foodlo aapp and zero confirmed facts rather than inventing a business baseline.
- Markdown export downloaded and contained the exact submitted question. Local Home preference survived reload and was restored. Search navigated to Data sources. Knowledge filter returned the expected empty result. Settings Team and Sign-in tabs worked.
- One real AI call was made in the requesting user's Foodlo workspace; visible available credits changed from **191 to 190**. Its saved verification conversation remains; no claims were confirmed or customer objectives edited.
- Switching between the user's two organizations remounted the AI workspace and cleared an unsent draft; Foodlo's zero-confirmed/15-review context appeared again. Each accessible organization had one workspace, so switching between two workspaces within a single organization was **not** browser-tested. Unit tests verify separate organization and workspace draft keys.
- Attempting a sixth file in the existing verification organization showed the actual five-document plan-limit denial. No quotas were increased and no existing files were removed. A temporary `source.txt` was then uploaded where quota was available, downloaded byte-for-byte and removed through the UI/storage flow. No test file remains.
- Organization owner access to `/admin` remained denied with “Platform Owner access required.” This is one signed-in role, not a fresh complete multi-role security UI test.
- 13 customer phone routes had no document-wide horizontal overflow; desktop/tablet navigation and actual mobile result readback passed. Settled screenshots were visually inspected in light and dark. Successful browser runs reported zero page errors. An initial premature draft observation was followed by a real asserted handoff check. The initial document test timed out on a genuine quota denial; subsequent quota and successful-file checks are recorded above.
- Public desktop/phone entry rendered with no phone-wide overflow; invalid password recovery was rejected. Automatic application checks reported **build OK**.

## 7. Remaining limitations and controlled pre-launch
This is not the full Definition of Done. Fresh signup/email-confirmation/onboarding completion, multiple-account team/invitation acceptance, profile confirmation, AI document extraction, actual approval decisions and same-organization multi-workspace switching were not exercised end-to-end in this turn. Existing implementations remain, with earlier evidence distinguished from current checks.

Before pre-launch: complete the remaining customer lifecycle/accessibility/browser/performance matrix; test revocation and switching during an in-flight AI call; add editable structured AI result documents and genuine specialist coordination if required; implement only real connector lifecycle/execution and measured analytics; finish rate/concurrency limits and hard cost pre-budgeting; validate account/MFA/session workflows and external Microsoft/OIDC sign-in with configured identities. SAML/SCIM, domain/role mapping and external connector permissions remain unconfigured or incomplete. No security or accessibility certification is claimed.

Platform Owner initialization, live payments, production publishing, external campaigns/outbound emails and SSO activation remain explicitly deferred. No production publication occurred.