import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Sparkles, Target, LineChart, Zap, Megaphone, Users } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Surge — AI Growth Platform" },
      { name: "description", content: "Surge runs AI growth agents that find customers, write campaigns and optimize every channel." },
      { property: "og:title", content: "Surge — AI Growth Platform" },
      { property: "og:description", content: "AI growth agents that find customers, write campaigns and optimize every channel." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  { icon: Target, title: "Find your buyers", text: "Agents scan signals across the web to surface high-intent prospects daily." },
  { icon: Megaphone, title: "Ship campaigns", text: "On-brand ads, emails and posts generated, tested and launched in minutes." },
  { icon: LineChart, title: "Optimize nonstop", text: "Budgets and messaging rebalance automatically toward what converts." },
];

const stats = [["3.4×", "pipeline growth"], ["-62%", "cost per lead"], ["40h", "saved weekly"]];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="bg-glow">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <span className="flex items-center gap-2 font-display text-xl font-bold">
            <Zap className="h-5 w-5 text-primary" /> Surge
          </span>
          <div className="hidden gap-8 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#results" className="hover:text-foreground">Results</a>
          </div>
          <a href="#start" className="rounded-full border border-border px-4 py-2 text-sm hover:bg-secondary">Get early access</a>
        </nav>

        <header className="mx-auto max-w-5xl px-6 pb-24 pt-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Autonomous growth, now in beta
          </span>
          <h1 className="mt-8 text-5xl font-extrabold leading-[1.05] tracking-tight md:text-7xl">
            Your growth team,<br /><span className="text-gradient">powered by AI.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Surge deploys AI agents that find customers, launch campaigns and optimize every channel — around the clock.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <a href="#start" className="inline-flex items-center gap-2 rounded-full bg-gradient-primary px-6 py-3 font-semibold text-primary-foreground shadow-glow transition-transform hover:scale-105">
              Start growing <ArrowRight className="h-4 w-4" />
            </a>
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

      <section id="results" className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 rounded-3xl border border-border bg-card p-12 md:grid-cols-3">
          {stats.map(([v, l]) => (
            <div key={l} className="text-center">
              <div className="font-display text-5xl font-extrabold text-gradient">{v}</div>
              <div className="mt-2 text-muted-foreground">{l}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="start" className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Users className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-6 text-4xl font-extrabold md:text-5xl">Ready to surge ahead?</h2>
        <p className="mt-4 text-muted-foreground">Join the waitlist and get your first AI growth agent free.</p>
        <form className="mx-auto mt-8 flex max-w-md gap-2" onSubmit={(e) => e.preventDefault()}>
          <input type="email" required placeholder="you@company.com" className="flex-1 rounded-full border border-input bg-secondary px-5 py-3 outline-none focus:ring-2 focus:ring-ring" />
          <button className="rounded-full bg-gradient-primary px-6 py-3 font-semibold text-primary-foreground">Join</button>
        </form>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">© 2026 Surge</footer>
    </div>
  );
}
