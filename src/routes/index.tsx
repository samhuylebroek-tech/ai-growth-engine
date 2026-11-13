import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles, Target, LineChart, Zap, Megaphone, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AI Growth OS — The operating system for business growth" },
      { name: "description", content: "AI Growth OS helps you understand your business, find opportunities and act on them — with AI that explains itself and asks before it acts." },
      { property: "og:title", content: "AI Growth OS — The operating system for business growth" },
      { property: "og:description", content: "Understand your business, find opportunities and act on them — with AI that asks before it acts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  { icon: Target, title: "Understand your business", text: "Upload plans and brand guides, add your website. Every fact keeps its source." },
  { icon: Megaphone, title: "Get clear recommendations", text: "Plain-language advice with reasoning, expected impact and risks." },
  { icon: LineChart, title: "Stay in control", text: "AI proposes, you approve. Every action and AI run is logged." },
];


function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="bg-glow">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="flex items-center gap-2 font-display text-xl font-bold">
            <Zap className="h-5 w-5 text-primary" /> AI Growth OS
          </span>
          <div className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <Link to="/pricing" className="hover:text-foreground">Pricing</Link>
          </div>
          <Link to="/auth" search={{ redirect: undefined }} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">Sign in</Link>
        </nav>

        <header className="mx-auto max-w-5xl px-6 pb-24 pt-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Early access
          </span>
          <h1 className="mt-8 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl">
            The operating system<br /><span className="text-gradient">for business growth.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Tell it what you want to achieve. Your AI Growth Officer learns your business, explains what it finds, and sends every action to you for approval.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link to="/auth" search={{ redirect: undefined }} className="inline-flex items-center gap-2 rounded-full bg-gradient-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105">
              Start free trial <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#features" className="rounded-full border border-border px-6 py-3 font-medium hover:bg-secondary">See how it works</a>
          </div>
        </header>
      </div>

      <section id="features" className="mx-auto grid max-w-6xl gap-5 px-6 py-20 md:grid-cols-3">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-border bg-card p-8 transition-colors hover:border-primary/40">
            <Icon className="h-7 w-7 text-primary" />
            <h3 className="mt-6 text-xl font-bold">{title}</h3>
            <p className="mt-2 text-muted-foreground">{text}</p>
          </div>
        ))}
      </section>


      <section id="start" className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Users className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-6 text-4xl font-extrabold md:text-5xl">Make growth measurable.</h2>
        <p className="mt-4 text-muted-foreground">14-day free trial with 200 AI credits. No card required.</p>
        <Link to="/auth" search={{ redirect: undefined }} className="mt-8 inline-flex rounded-full bg-gradient-primary px-6 py-3 font-semibold text-primary-foreground">Create your account</Link>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">© 2026 AI Growth OS</footer>
    </div>
  );
}
