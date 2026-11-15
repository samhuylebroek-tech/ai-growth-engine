# Enterprise authentication — 2026-11-15

## Available application paths
- Email/password: signup, confirmation-message state, sign-in/out and password reset exist. Recovery requires a recovery-type link and session. Email delivery and hosted signup/settings were not freshly verified in this session.
- Google: managed sign-in remains enabled and uses the branded button.
- Microsoft Entra ID: managed Microsoft sign-in is enabled and the button uses the same safe return path. A real Microsoft account redirect/sign-in was not exercised.
- Organization OIDC: the app calls the platform's dedicated `custom:app-oidc` provider. An authorized administrator must configure the issuer, client ID and client secret in Lovable Cloud Auth settings; secrets must never be pasted into chat or source. Register the callback URL shown in those settings with the identity provider. No successful OIDC authentication is claimed yet.

## SAML and SCIM status
SAML is **not configured**. The controlled SAML configuration flow was declined, so no provider was activated and no ACS URL, SP Entity ID, metadata, certificate validation, domain verification or test authentication is claimed. Do not show invented values for these fields. A future controlled setup must use the platform-supported SAML flow and an authorized organization administrator.

SCIM 2.0 provisioning is not implemented. No SCIM endpoint or provisioning success is claimed.

## Security boundaries
- Platform Owner roles remain in a separate protected table. No OAuth/OIDC path assigns platform or organization roles.
- Current OIDC support is a single platform-configured provider, not completed organization-specific routing. Domain verification, per-organization provider configuration, group/role mapping, account-linking controls, session-revocation UI and enterprise audit views remain unfinished.
- Enterprise/Custom entitlement rows alone do not prove a provider is configured or usable. UI and documentation must distinguish configured, tested and unavailable states.

## Required controlled validation before claiming SSO
Test valid and invalid metadata/certificates, assertion signatures/audience/recipient/destination/time windows/replay protection through the platform provider, verified-domain routing, wrong-domain and cross-tenant denial, account linking, role mapping, session revocation and audit records. These tests were not run because SAML setup was declined and OIDC provider details were not supplied.
