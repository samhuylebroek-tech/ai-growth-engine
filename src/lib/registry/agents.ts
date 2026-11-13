import { defineAgent } from "./types";

export const AGENTS = [
  defineAgent({ key: "growth_officer", name: "Chief Growth Officer", description: "Your main AI partner. Understands your business and coordinates the other agents.", capabilities: ["profile.read", "strategy.recommend", "approvals.propose"], status: "implemented" }),
  defineAgent({ key: "business_intelligence", name: "Business Intelligence", description: "Turns documents and your website into structured business facts.", capabilities: ["profile.read", "documents.extract_facts", "website.analyze"], status: "implemented" }),
  defineAgent({ key: "market_research", name: "Market Research", description: "Researches markets, segments and demand.", capabilities: ["profile.read"], status: "planned" }),
  defineAgent({ key: "competitor_intel", name: "Competitor Intelligence", description: "Tracks competitors' positioning, pricing and moves.", capabilities: ["profile.read"], status: "planned" }),
  defineAgent({ key: "marketing_strategy", name: "Marketing Strategy", description: "Builds channel strategies and campaign plans.", capabilities: ["profile.read", "strategy.recommend"], status: "planned" }),
  defineAgent({ key: "seo", name: "SEO", description: "Finds search opportunities and technical issues.", capabilities: ["profile.read"], status: "planned" }),
  defineAgent({ key: "content", name: "Content", description: "Drafts on-brand content for review.", capabilities: ["profile.read", "content.publish"], status: "planned" }),
  defineAgent({ key: "social", name: "Social Media", description: "Plans and schedules social posts.", capabilities: ["profile.read", "content.publish"], status: "planned" }),
  defineAgent({ key: "advertising", name: "Advertising", description: "Optimizes paid campaigns and budgets.", capabilities: ["profile.read", "ads.adjust_budget"], status: "planned" }),
  defineAgent({ key: "crm", name: "CRM & Lead Generation", description: "Finds and qualifies leads.", capabilities: ["profile.read", "crm.create_lead"], status: "planned" }),
  defineAgent({ key: "email", name: "Email Marketing", description: "Designs and sends lifecycle email.", capabilities: ["profile.read", "email.send_campaign"], status: "planned" }),
];
