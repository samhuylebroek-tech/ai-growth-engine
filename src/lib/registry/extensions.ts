import { defineExtension } from "./types";

export const EXTENSIONS = [
  defineExtension({ key: "growth_officer", name: "AI Growth Officer", description: "Conversational growth partner.", phase: 1, status: "implemented" }),
  defineExtension({ key: "business_intelligence", name: "Business Intelligence", description: "Profile, documents and facts.", phase: 1, status: "implemented" }),
  defineExtension({ key: "approvals", name: "Approvals", description: "Human control over AI actions.", phase: 1, status: "implemented" }),
  defineExtension({ key: "strategy", name: "Strategy & Opportunities", description: "Growth plans and opportunity discovery.", phase: 8, status: "implemented" }),
  defineExtension({ key: "seo_content", name: "SEO & Content", description: "Technical SEO check of public pages and content drafting with versioned approval; no external publishing.", phase: 9, status: "partial" }),
  defineExtension({ key: "social_ads", name: "Social & Advertising", description: "Organic and paid channels.", phase: 10, status: "planned" }),
  defineExtension({ key: "crm_sales", name: "CRM & Sales", description: "Contacts and deals you enter, plus a read-only HubSpot import; nothing is written to a CRM.", phase: 11, status: "partial" }),
  defineExtension({ key: "email_automation", name: "Email & Automation", description: "Lifecycle email and workflows.", phase: 12, status: "planned" }),
  defineExtension({ key: "revenue", name: "Revenue Intelligence", description: "Recorded revenue and attribution by source; no forecasting yet.", phase: 13, status: "partial" }),
  defineExtension({ key: "reports", name: "Reports", description: "Scheduled reports and dashboards.", phase: 14, status: "planned" }),
];
