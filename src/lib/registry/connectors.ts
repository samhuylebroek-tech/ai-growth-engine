import { defineConnector } from "./types";

export const CONNECTORS = [
  defineConnector({ key: "website", name: "Website", category: "Data sources", description: "Analyze your public website.", auth: "none", capabilities: ["website.analyze"], status: "implemented" }),
  defineConnector({ key: "documents", name: "Document upload", category: "Data sources", description: "PDF, Word, Excel, CSV and text files.", auth: "none", capabilities: ["documents.extract_facts"], status: "implemented" }),
  defineConnector({ key: "google_analytics", name: "Google Analytics", category: "Analytics", description: "Traffic, conversions and audiences.", auth: "oauth", capabilities: [], status: "planned", requires: "Google OAuth app credentials" }),
  defineConnector({ key: "search_console", name: "Google Search Console", category: "SEO", description: "Search queries, rankings and indexing.", auth: "oauth", capabilities: [], status: "planned", requires: "Google OAuth app credentials" }),
  defineConnector({ key: "meta_ads", name: "Meta Ads", category: "Advertising", description: "Facebook and Instagram campaigns.", auth: "oauth", capabilities: ["ads.adjust_budget"], status: "planned", requires: "Meta app review" }),
  defineConnector({ key: "google_ads", name: "Google Ads", category: "Advertising", description: "Search and display campaigns.", auth: "oauth", capabilities: ["ads.adjust_budget"], status: "planned", requires: "Google Ads developer token" }),
  defineConnector({ key: "linkedin", name: "LinkedIn", category: "Social", description: "Company page posts and analytics.", auth: "oauth", capabilities: ["content.publish"], status: "planned", requires: "LinkedIn app credentials" }),
  defineConnector({ key: "hubspot", name: "HubSpot", category: "CRM", description: "Contacts, deals and pipelines.", auth: "oauth", capabilities: ["crm.create_lead"], status: "planned", requires: "HubSpot app credentials" }),
  defineConnector({ key: "mailchimp", name: "Mailchimp", category: "Email", description: "Audiences and campaigns.", auth: "api_key", capabilities: ["email.send_campaign"], status: "planned", requires: "Mailchimp API key" }),
  defineConnector({ key: "stripe", name: "Stripe", category: "Revenue", description: "Revenue and subscription data.", auth: "api_key", capabilities: [], status: "planned", requires: "Stripe account" }),
  defineConnector({ key: "shopify", name: "Shopify", category: "Revenue", description: "Orders, products and customers.", auth: "oauth", capabilities: [], status: "planned", requires: "Shopify app" }),
];
