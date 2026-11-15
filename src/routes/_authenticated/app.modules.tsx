import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Compass, Megaphone, Users, Globe2, LineChart, ArrowUpRight, Search, Sparkles } from "lucide-react";
import { EXTENSIONS } from "@/lib/registry/extensions";
import { PageHeader, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GrowthQuestion } from "@/components/app/growth-question";
export const Route = createFileRoute("/_authenticated/app/modules")({ head: () => pageHead("Growth areas", "Strategy, marketing, sales, website and measurement availability."), component: Modules });
const AREAS = [
 { title: "Strategy & growth", icon: Compass, text: "Business understanding, opportunities and an evidence-aware action plan.", keys: ["strategy"], to: "/app/intelligence" as const, action: "Open growth intelligence", note: "Website research and conversational planning are available. Dedicated strategy workflows are planned." },
 { title: "Marketing", icon: Megaphone, text: "Strategy, content, social, advertising and lifecycle communication.", keys: ["seo_content", "social_ads", "email_automation"], to: "/app/growth-officer" as const, action: "Discuss marketing strategy", note: "AI planning is available in conversations. Campaign publishing, scheduling and sending are not configured." },
 { title: "Sales & customers", icon: Users, text: "Acquisition, customer understanding and sales priorities.", keys: ["crm_sales"], to: "/app/growth-officer" as const, action: "Discuss sales priorities", note: "Conversation-based planning only. CRM connections, leads and pipeline execution are not configured." },
 { title: "Website & conversion", icon: Globe2, text: "Research your public website and confirm business findings.", keys: ["seo_content"], to: "/app/onboarding" as const, action: "Research your website", note: "Public website discovery is available. Technical SEO auditing and conversion measurements are planned." },
 { title: "Analytics & results", icon: LineChart, text: "Recorded AI work, credit usage and business measurement.", keys: ["revenue", "reports"], to: "/app/activity" as const, action: "View recorded work", note: "AI activity and credit history are available. Revenue analytics and scheduled reporting are not configured." },
];
function Modules() {
 const [filter,setFilter] = useState("");
 const areas = AREAS.filter(a => `${a.title} ${a.text}`.toLowerCase().includes(filter.toLowerCase()));
 return <><PageHeader title="Growth areas" description="Your business priorities, brought together." /><div className="mb-7 flex items-center gap-2 border-b border-border pb-5"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label="Search growth areas" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a growth area…" className="max-w-sm" /></div><div className="grid gap-x-10 gap-y-7 md:grid-cols-2">{areas.map(a => <section key={a.title} className="border-b border-border pb-7"><a.icon className="mb-4 h-6 w-6 text-primary" /><h2 className="text-base font-semibold">{a.title}</h2><p className="mt-2 text-sm text-muted-foreground">{a.text}</p><div className="mt-4 space-y-2">{EXTENSIONS.filter(e => a.keys.includes(e.key)).map(e => <div key={e.key} className="flex items-center justify-between gap-3 text-xs"><span>{e.name}</span><StatusChip status={e.status} /></div>)}</div><p className="mt-4 text-xs leading-relaxed text-muted-foreground">{a.note}</p><Button variant="link" className="mt-3 px-0" asChild><Link to={a.to}>{a.action}<ArrowUpRight /></Link></Button></section>)}</div>{!areas.length && <p className="py-10 text-sm text-muted-foreground">No growth areas match your search.</p>}<section className="mt-10 max-w-2xl"><div className="mb-4 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="font-semibold">Start with the Growth Officer</h2></div><GrowthQuestion compact /></section></>;
}
