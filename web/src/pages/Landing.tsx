import { Link } from "react-router-dom";
import {
  ArrowRight,
  Calendar,
  Check,
  Download,
  KeyRound,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";

/**
 * Public marketing landing page — the front door for logged-out visitors at `/`.
 * "Operator's console" identity: warm serif headlines, monospace instrument
 * labels, indigo the only accent, emerald reserved for growth signals. The
 * dark "console" panels are intentionally dark in both themes (they read as the
 * product screen). All copy maps to real, shipped capabilities.
 */

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-[0.95rem] font-semibold text-white shadow-sm shadow-brand-600/30 outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none";
const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-5 py-3 text-[0.95rem] font-semibold text-ink outline-none transition hover:bg-hover focus-visible:ring-2 focus-visible:ring-brand-100 motion-reduce:transition-none";
const eyebrow =
  "font-mono text-[0.7rem] font-medium uppercase tracking-[0.16em] text-accent";
const chipCls =
  "rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 font-mono text-[0.68rem] text-accent-soft-fg";

export function Landing() {
  return (
    <div className="min-h-full bg-canvas text-ink">
      <PageStyle />

      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-line bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[1.05rem] font-semibold tracking-tight">
              Inflxr
            </span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
            <NavLink href="#loop">How it works</NavLink>
            <NavLink href="#features">Features</NavLink>
            <NavLink href="#byok">Bring your keys</NavLink>
            <NavLink href="#agencies">For agencies</NavLink>
          </nav>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="hidden text-sm font-medium text-muted transition hover:text-ink sm:block"
            >
              Sign in
            </Link>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 transition hover:bg-brand-700"
            >
              Start free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-32 h-[560px] w-[560px] rounded-full bg-brand-500/20 blur-3xl"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-6 py-16 md:py-24 lg:grid-cols-[1.02fr_0.98fr]">
          <div className="lp-fade">
            <p className={eyebrow}>
              Autonomous social marketing · bring your own keys
            </p>
            <h1 className="mt-5 font-serif text-[clamp(2.6rem,5.6vw,4rem)] font-semibold leading-[1.03] tracking-tight text-balance">
              Marketing that
              <br />
              runs itself.
            </h1>
            <p className="mt-5 max-w-[34ch] text-[1.18rem] leading-[1.55] text-muted">
              Give Inflxr one goal. It plans a two-week calendar, writes the
              captions, generates the visuals, schedules every post, and learns
              what works — all in your brand's voice, all on your own keys.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className={btnPrimary}>
                Start free — no password <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#loop" className={btnGhost}>
                Watch the loop
              </a>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.72rem] text-faint">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/20" />
              Free to start
              <span>·</span> No credit card
              <span>·</span> Your keys, your data
            </div>
          </div>

          <div className="lp-fade" style={{ animationDelay: "0.1s" }}>
            <Console />
          </div>
        </div>
      </section>

      {/* ── Providers ───────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-4 pt-2">
        <p className="mb-5 text-center font-mono text-[0.68rem] uppercase tracking-[0.14em] text-faint">
          Brings the best models — you bring the keys
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <ProviderChip role="Text" name="Claude" />
          <ProviderChip role="Image" name="FLUX" />
          <ProviderChip role="Video" name="Kling" />
          <ProviderChip role="Voice" name="ElevenLabs" />
          <ProviderChip role="Publish" name="Instagram" />
          <ProviderChip role="Studio" name="Higgsfield" />
        </div>
      </section>

      {/* ── Flywheel ────────────────────────────────────────── */}
      <section id="loop" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-[60ch]">
            <p className={eyebrow}>The Inflxr loop</p>
            <h2 className="mt-3 font-serif text-[clamp(1.9rem,3.4vw,2.7rem)] font-semibold leading-[1.08] tracking-tight text-balance">
              Four steps. One that never stops.
            </h2>
            <p className="mt-3.5 text-[1.18rem] leading-[1.55] text-muted">
              Most tools help you make a post. Inflxr runs the whole cycle —
              plan, create, publish, learn — and every cycle makes the next one
              smarter.
            </p>
          </div>

          <div className="mt-12 grid items-center gap-14 lg:grid-cols-[420px_1fr]">
            <Flywheel />
            <div>
              <LoopStep n="01" title="Plan">
                State an outcome. Inflxr proposes an approvable 8–12 post plan
                across two weeks, grounded in your pillars.
              </LoopStep>
              <LoopStep n="02" title="Create">
                Every draft gets a caption, image, video, and voiceover —
                generated in your brand's voice and look.
              </LoopStep>
              <LoopStep n="03" title="Publish">
                Approve once. A background worker schedules and posts to
                Instagram server-side, on time, without you.
              </LoopStep>
              <LoopStep n="04" title="Learn" pos>
                The Brand Brain reads what performed and feeds it back — so the
                next plan starts smarter than the last.
              </LoopStep>
            </div>
          </div>
        </div>
      </section>

      {/* ── Beats ───────────────────────────────────────────── */}
      <section id="features" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="mb-11 max-w-[60ch]">
            <p className={eyebrow}>What it actually does</p>
            <h2 className="mt-3 font-serif text-[clamp(1.9rem,3.4vw,2.7rem)] font-semibold leading-[1.08] tracking-tight text-balance">
              The whole workflow, on one brain.
            </h2>
          </div>

          <div className="grid gap-5">
            <Beat
              num="01"
              kicker="Plan"
              title="From one goal to an approvable plan."
              chips={["Goal-driven mode", "Pillars × cadence", "Intent Preview"]}
              mock={<PlanMock />}
            >
              Type an outcome like{" "}
              <em className="text-ink">
                "grow followers before the fall launch."
              </em>{" "}
              Inflxr grounds a plan in your brand and content pillars and hands
              you an Intent Preview — 8–12 concrete posts across 14 days. Approve
              it and the whole calendar drops into your queue as drafts. Edit
              anything; nothing goes live without your yes.
            </Beat>

            <Beat
              num="02"
              kicker="Create"
              reversed
              title="On-brand captions, images, video, and voice."
              chips={["FLUX images", "Kling video", "ElevenLabs voice", "In your voice"]}
              mock={<ComposeMock />}
            >
              Every draft gets finished in your voice. Captions from Claude,
              images from FLUX, video from Kling, voiceovers from ElevenLabs —
              your colors and visual direction applied before a pixel is made.
              It's never one-shot: accept, steer, or regenerate in place until
              it's right.
            </Beat>

            <Beat
              num="03"
              kicker="Publish"
              title="Scheduled, published, and approved — without you."
              chips={["Auto-publish queue", "Team review", "Client approval portal"]}
              mock={<QueueMock />}
            >
              Inflxr posts to Instagram server-side on a queue, so nothing waits
              on your phone. Route posts through internal review, or send a
              client a no-login link to approve or comment on a single post. A
              background worker ships each one at its time — and one bad post
              never blocks the batch.
            </Beat>

            <Beat
              num="04"
              kicker="Learn"
              reversed
              pos
              title="It gets better every week."
              chips={["Brand Brain", "Learns from results", "Weekly analytics + AI insights"]}
              mock={<BrainMock />}
            >
              The Brand Brain reads your real Instagram performance — saves,
              reach, top captions — and turns it into patterns and voice examples
              you can apply with a tap. Whatever you keep feeds every future
              caption, plan, and post. Analytics arrive with week-over-week
              deltas and an AI action plan.
            </Beat>
          </div>
        </div>
      </section>

      {/* ── BYOK ────────────────────────────────────────────── */}
      <section id="byok" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="max-w-[60ch]">
            <p className={eyebrow}>Bring your own keys</p>
            <h2 className="mt-3 font-serif text-[clamp(1.9rem,3.4vw,2.7rem)] font-semibold leading-[1.08] tracking-tight text-balance">
              Your keys. Your data. No markup.
            </h2>
            <p className="mt-3.5 text-[1.18rem] leading-[1.55] text-muted">
              Inflxr is a harness, not a walled garden. You plug in the accounts
              you already pay for — and keep control of every one.
            </p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <ByokCard
              icon={KeyRound}
              title="Bring your own keys"
              body="Plug in your own Claude, fal, ElevenLabs and Instagram keys. Pay the providers directly — Inflxr never marks up a token or a generation."
            />
            <ByokCard
              icon={ShieldCheck}
              title="Encrypted, and yours"
              body="Every connector secret and access token is encrypted at rest. We log ids and counts — never your captions, your emails, or your tokens."
            />
            <ByokCard
              icon={Download}
              title="Leave anytime"
              body="One-click export of everything you've made, and a real delete that purges your media. No lock-in, no hostage data — ever."
            />
          </div>
        </div>
      </section>

      {/* ── MCP band ────────────────────────────────────────── */}
      <section id="mcp" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="relative overflow-hidden rounded-3xl bg-[#0d1120] p-9 text-white md:p-13">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-10 -top-20 h-[380px] w-[380px] rounded-full bg-brand-500/25 blur-3xl"
            />
            <div className="relative grid items-center gap-11 lg:grid-cols-[1.05fr_0.95fr]">
              <div>
                <p className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-brand-200">
                  For the agentic
                </p>
                <h2 className="mt-3 font-serif text-[clamp(1.8rem,3vw,2.4rem)] font-semibold leading-tight tracking-tight text-balance">
                  Or skip the UI. Drive it from Claude.
                </h2>
                <p className="mt-3.5 text-[0.98rem] leading-relaxed text-white/60">
                  Inflxr is a full MCP server — the same loop, exposed as tools
                  any agent can call: read the brand profile, generate on-brand
                  media, schedule, publish, and read the analytics back. Point
                  Claude at it and say{" "}
                  <em className="text-white/80">"warm up next week's launch."</em>
                </p>
                <pre className="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-black/30 px-4 py-4 font-mono text-[0.82rem] leading-relaxed text-[#e6e8f6]">
                  <span className="text-white/40"># add the harness to your MCP client</span>
                  {"\n"}claude mcp add --transport http{" "}
                  <span className="text-brand-200">inflxr</span>{" "}
                  <span className="text-emerald-300">https://inflxr.com/mcp</span>
                </pre>
              </div>
              <div>
                <p className="mb-3 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white/40">
                  29 tools · same connectors as the UI
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "get_brand_profile",
                    "propose_goal_plan",
                    "generate_image",
                    "generate_video",
                    "generate_voice",
                    "generate_caption",
                    "ig_schedule_image",
                    "ig_publish_carousel",
                    "ig_analytics_insights",
                    "relearn_brand_brain",
                  ].map((t) => (
                    <span
                      key={t}
                      className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[0.72rem] text-white/75"
                    >
                      {t}
                    </span>
                  ))}
                  <span className="rounded-lg border border-brand-500/50 px-2.5 py-1.5 font-mono text-[0.72rem] text-brand-200">
                    + 19 more
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Agencies ────────────────────────────────────────── */}
      <section id="agencies" className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-24">
          <div className="grid items-center gap-14 lg:grid-cols-2">
            <div>
              <p className={eyebrow}>One brand — or twenty</p>
              <h2 className="mt-3 font-serif text-[clamp(1.8rem,3.2vw,2.5rem)] font-semibold leading-[1.1] tracking-tight text-balance">
                Built for solo founders and small studios.
              </h2>
              <p className="mb-6 mt-3.5 text-[1.18rem] leading-[1.55] text-muted">
                Every brand is its own isolated workspace — its own voice,
                pillars, keys, and queue. Switch in a click. Invite a client to
                approve a post without ever making an account. The coordination
                tax that eats <em className="text-ink">40% of multi-brand time</em>?
                Gone.
              </p>
              <Link to="/login" className={btnPrimary}>
                Start with your first brand <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <WorkspaceMock />
          </div>
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────── */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center md:py-28">
          <p className={`${eyebrow} inline-block`}>Two minutes to your first plan</p>
          <h2 className="mx-auto mt-4 max-w-[18ch] font-serif text-[clamp(2.2rem,4.6vw,3.4rem)] font-semibold leading-[1.05] tracking-tight text-balance">
            Give it your first goal tonight.
          </h2>
          <p className="mx-auto mt-4 max-w-[46ch] text-[1.18rem] leading-[1.55] text-muted">
            Free to start. No password, no card. Your first brand brain — belief,
            voice, audience and content themes — is two minutes away.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className={btnPrimary}>
              Start free — no password <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#loop" className={btnGhost}>
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="flex flex-wrap items-start justify-between gap-8">
            <div>
              <Link to="/" className="flex items-center gap-2.5">
                <Mark />
                <span className="text-[1.05rem] font-semibold tracking-tight">
                  Inflxr
                </span>
              </Link>
              <p className="mt-3 max-w-[34ch] text-sm text-muted">
                Autonomous marketing you own. Bring your keys, state a goal, and
                let the loop run.
              </p>
            </div>
            <div className="flex flex-wrap gap-10">
              <FooterCol title="Product">
                <a href="#loop">How it works</a>
                <a href="#features">Features</a>
                <a href="#mcp">MCP server</a>
              </FooterCol>
              <FooterCol title="Who it's for">
                <a href="#agencies">Solo founders</a>
                <a href="#agencies">Small agencies</a>
                <a href="#byok">Bring your keys</a>
              </FooterCol>
              <FooterCol title="Get started">
                <Link to="/login">Start free</Link>
                <Link to="/login">Sign in</Link>
              </FooterCol>
            </div>
          </div>
          <div className="mt-9 flex flex-wrap justify-between gap-2 border-t border-line pt-6 font-mono text-[0.7rem] tracking-[0.03em] text-faint">
            <span>© 2026 Inflxr · BYOK · MCP-native</span>
            <span>Instagram publishing · built for the solo operator</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────────────── */

function Mark() {
  return (
    <span className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-brand-600 text-[0.95rem] font-extrabold text-white shadow-sm shadow-brand-600/40">
      i
    </span>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="text-sm font-medium text-muted transition hover:text-ink"
    >
      {children}
    </a>
  );
}

function ProviderChip({ role, name }: { role: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-2">
      <span className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-faint">
        {role}
      </span>
      <b className="text-[0.9rem] font-semibold text-ink">{name}</b>
    </span>
  );
}

function LoopStep({
  n,
  title,
  pos,
  children,
}: {
  n: string;
  title: string;
  pos?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[26px_1fr] gap-3.5 border-b border-line py-4 last:border-0">
      <span
        className={`font-mono text-sm font-semibold ${
          pos ? "text-emerald-600 dark:text-emerald-400" : "text-accent-soft-fg"
        }`}
      >
        {n}
      </span>
      <div>
        <h3 className="font-serif text-[1.16rem] font-semibold tracking-tight">
          {title}
        </h3>
        <p className="mt-0.5 text-[0.96rem] text-muted">{children}</p>
      </div>
    </div>
  );
}

function ByokCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof KeyRound;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-fg">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="font-serif text-[1.14rem] font-semibold tracking-tight">
        {title}
      </h3>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function FooterCol({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 [&>a]:text-sm [&>a]:text-muted [&>a]:transition hover:[&>a]:text-ink">
      <span className="mb-0.5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-faint">
        {title}
      </span>
      {children}
    </div>
  );
}

function Beat({
  num,
  kicker,
  title,
  chips,
  mock,
  reversed,
  pos,
  children,
}: {
  num: string;
  kicker: string;
  title: string;
  chips: string[];
  mock: React.ReactNode;
  reversed?: boolean;
  pos?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="grid items-center gap-9 rounded-3xl border border-line bg-surface p-8 shadow-sm md:grid-cols-2 md:p-10">
      <div className={reversed ? "md:order-2" : ""}>
        <span className="inline-flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-accent">
          <span className="text-faint">{num}</span> {kicker}
        </span>
        <h3 className="mt-3.5 mb-3 font-serif text-[1.62rem] font-semibold leading-[1.12] tracking-tight text-balance">
          {title}
        </h3>
        <p className="mb-[18px] text-[1.01rem] leading-relaxed text-muted">
          {children}
        </p>
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span
              key={c}
              className={
                pos
                  ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[0.68rem] text-emerald-700 dark:text-emerald-400"
                  : chipCls
              }
            >
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className={reversed ? "md:order-1" : ""}>{mock}</div>
    </article>
  );
}

/* ── Mock frames (product, drawn) ──────────────────────────── */

function MockFrame({
  left,
  right,
  children,
}: {
  left: string;
  right: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[220px] flex-col gap-2.5 rounded-2xl border border-line bg-elevated p-4 shadow-sm">
      <div className="flex items-center justify-between font-mono text-[0.62rem] uppercase tracking-[0.12em] text-faint">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      {children}
    </div>
  );
}

function PlanMock() {
  const rows: [string, string, string][] = [
    ["MON", "Founder story carousel", "Belief"],
    ["WED", "Reel · 3 category myths", "Educate"],
    ["FRI", "Before/after + offer", "Convert"],
    ["SUN", "Behind the scenes", "Culture"],
  ];
  return (
    <MockFrame left="Content plan" right="14 days">
      {rows.map(([d, t, p]) => (
        <div
          key={d}
          className="grid grid-cols-[34px_1fr_auto] items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2.5"
        >
          <span className="font-mono text-[0.62rem] text-faint">{d}</span>
          <span className="text-[0.86rem]">{t}</span>
          <span className="rounded-full border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[0.58rem] uppercase text-accent-soft-fg">
            {p}
          </span>
        </div>
      ))}
    </MockFrame>
  );
}

function ComposeMock() {
  return (
    <MockFrame left="Composer" right="Draft · Reel">
      <div className="grid grid-cols-[88px_1fr] gap-3">
        <div
          className="relative aspect-square overflow-hidden rounded-xl border border-line"
          style={{
            background:
              "radial-gradient(120% 120% at 20% 15%, rgba(99,102,241,0.65), transparent 60%), radial-gradient(120% 120% at 90% 90%, rgba(16,185,129,0.5), transparent 55%), #0d1120",
          }}
        >
          <span className="absolute bottom-1.5 left-2 font-mono text-[0.52rem] tracking-[0.1em] text-white/70">
            FLUX
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <i className="block h-2 w-[96%] rounded bg-line-strong" />
          <i className="block h-2 w-[88%] rounded bg-line-strong" />
          <i className="block h-2 w-[62%] rounded bg-line-strong" />
          <div className="mt-1 flex gap-1.5">
            <span className="rounded-md border border-accent-line bg-accent-soft px-2 py-1 font-mono text-[0.62rem] text-accent-soft-fg">
              Use this
            </span>
            <span className="rounded-md border border-line-strong px-2 py-1 font-mono text-[0.62rem] text-muted">
              Try another
            </span>
            <span className="rounded-md border border-line-strong px-2 py-1 font-mono text-[0.62rem] text-muted">
              Bolder
            </span>
          </div>
        </div>
      </div>
      <div className="mt-0.5 flex items-center justify-between rounded-xl border border-line bg-surface px-2.5 py-2.5">
        <span className="text-[0.86rem]">Voiceover · Rachel</span>
        <span className="rounded-full border border-accent-line bg-accent-soft px-1.5 py-0.5 font-mono text-[0.58rem] uppercase text-accent-soft-fg">
          ElevenLabs
        </span>
      </div>
    </MockFrame>
  );
}

function QueueMock() {
  const rows: [string, "sched" | "appr"][] = [
    ["09:00", "sched"],
    ["13:30", "appr"],
    ["18:00", "sched"],
  ];
  return (
    <MockFrame left="Queue · Thursday" right="Auto-publish on">
      {rows.map(([t, s]) => (
        <div
          key={t}
          className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2"
        >
          <span className="w-[52px] font-mono text-[0.64rem] text-faint">
            {t}
          </span>
          <span className="h-2 flex-1 rounded bg-line-strong" />
          {s === "appr" ? (
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.58rem] uppercase text-emerald-700 dark:text-emerald-400">
              Client approved
            </span>
          ) : (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[0.58rem] uppercase text-accent-soft-fg">
              Scheduled
            </span>
          )}
        </div>
      ))}
    </MockFrame>
  );
}

function BrainMock() {
  return (
    <MockFrame left="Brand Brain" right="Learning strength · 72">
      <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
        <p className="text-[0.88rem]">
          Carousels earn <b>37% more saves</b> than single images for you.
        </p>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[0.64rem] text-emerald-700 dark:text-emerald-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          High impact · from last 30 days
        </div>
        <div className="mt-2.5 flex gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1 font-mono text-[0.62rem] text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> Apply to plan
          </span>
          <span className="rounded-md border border-line-strong px-2.5 py-1 font-mono text-[0.62rem] text-faint">
            Dismiss
          </span>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between px-0.5 pt-1">
        <svg width="150" height="34" viewBox="0 0 150 34" fill="none" aria-hidden>
          <path
            d="M2 30 L20 27 L38 28 L56 21 L74 22 L92 15 L110 16 L128 8 L148 4"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-500"
          />
          <circle cx="148" cy="4" r="3" className="fill-emerald-500" />
        </svg>
        <span className="font-mono text-[0.72rem] tabular-nums text-emerald-700 dark:text-emerald-400">
          <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
          +18.4% reach · 4 wk
        </span>
      </div>
    </MockFrame>
  );
}

function WorkspaceMock() {
  return (
    <div className="rounded-2xl border border-line bg-elevated p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between font-mono text-[0.62rem] uppercase tracking-[0.12em] text-faint">
        <span>Workspace</span>
        <span>3 brands</span>
      </div>
      {[
        ["Zenith Studio", "Active", "accent"],
        ["Harbor Coffee Co.", "2 to review", "pos"],
        ["Field & Fern", "Scheduled", "accent"],
      ].map(([name, label, tone], i) => (
        <div
          key={name}
          className="mb-2 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2.5 last:mb-0"
        >
          <span
            className={
              i === 0 ? "text-accent-soft-fg" : "text-faint"
            }
          >
            ◆
          </span>
          <span className="text-[0.9rem]">{name}</span>
          <span
            className={
              tone === "pos"
                ? "rounded-full bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.58rem] uppercase text-emerald-700 dark:text-emerald-400"
                : "rounded-full border border-accent-line bg-accent-soft px-2 py-0.5 font-mono text-[0.58rem] uppercase text-accent-soft-fg"
            }
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Hero console ──────────────────────────────────────────── */

function Console() {
  const steps: [string, string, string, boolean][] = [
    ["MON", "Founder story carousel — why we started", "Belief", false],
    ["WED", "Reel: 3 myths about the category", "Educate", false],
    ["FRI", "Before/after with early-access offer", "Convert", true],
    ["SUN", "Behind the scenes at the studio", "Culture", false],
  ];
  return (
    <div
      className="overflow-hidden rounded-[18px] border border-white/10 bg-[#0d1120] p-4 text-[#eceef9] shadow-2xl shadow-black/30"
      role="img"
      aria-label="Inflxr turning one goal into an approved two-week content plan that auto-schedules to Instagram."
    >
      <div className="flex items-center gap-2 px-1 pb-3.5 pt-1">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </span>
        <span className="ml-1.5 text-[0.8rem] text-white/50">
          <b className="font-semibold text-white/90">Zenith Studio</b> ·
          Instagram
        </span>
      </div>

      <div className="mx-1 mb-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3">
        <span className="mb-1.5 block font-mono text-[0.62rem] uppercase tracking-[0.14em] text-white/45">
          Your goal
        </span>
        <div className="text-[0.98rem] leading-snug">
          Grow followers before the fall launch
          <span className="lp-cursor" />
        </div>
      </div>

      <div className="mx-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-brand-200">
            Intent preview — agent proposed
          </span>
          <span className="font-mono text-[0.66rem] text-white/45">
            8 posts · 14 days
          </span>
        </div>
        {steps.map(([d, w, p, isPos]) => (
          <div
            key={d}
            className="mb-1.5 grid grid-cols-[40px_1fr_auto] items-center gap-2.5 rounded-[10px] border border-white/10 bg-white/[0.03] px-2.5 py-2.5"
          >
            <span className="font-mono text-[0.64rem] tracking-[0.08em] text-white/45">
              {d}
            </span>
            <span className="text-[0.85rem] leading-tight text-white/90">
              {w}
            </span>
            <span
              className={`whitespace-nowrap rounded-full border px-1.5 py-0.5 font-mono text-[0.6rem] uppercase ${
                isPos
                  ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200"
                  : "border-brand-500/40 bg-brand-500/15 text-brand-100"
              }`}
            >
              {p}
            </span>
          </div>
        ))}
      </div>

      <div className="mx-1 mt-3 flex items-center justify-between gap-2.5 border-t border-white/10 pt-3">
        <span className="flex items-center gap-2 font-mono text-[0.72rem] text-emerald-400">
          <svg width="46" height="16" viewBox="0 0 46 16" fill="none" aria-hidden>
            <path
              d="M1 14 L10 11 L18 12 L27 6 L35 7 L45 2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          followers +6.2% wk
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-[0.78rem] font-semibold text-white">
          Approve plan <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </div>
  );
}

/* ── Flywheel ──────────────────────────────────────────────── */

function Flywheel() {
  const nodes = [
    { icon: Calendar, name: "Plan", num: "01", top: "3%", left: "50%" },
    { icon: Sparkles, name: "Create", num: "02", top: "50%", left: "97%" },
    { icon: Send, name: "Publish", num: "03", top: "97%", left: "50%" },
    { icon: RefreshCcw, name: "Learn", num: "04", top: "50%", left: "3%", pos: true },
  ];
  return (
    <div
      className="relative mx-auto aspect-square w-full max-w-[420px]"
      aria-hidden
    >
      <div className="absolute inset-0 rounded-full border border-dashed border-line-strong" />
      <div className="lp-sweep" />
      {nodes.map((n) => (
        <div
          key={n.name}
          className="absolute w-[118px] -translate-x-1/2 -translate-y-1/2 text-center"
          style={{ top: n.top, left: n.left }}
        >
          <span
            className={`mx-auto mb-2.5 grid h-[74px] w-[74px] place-items-center rounded-[20px] border bg-surface shadow-md ${
              n.pos
                ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                : "border-line-strong text-accent-soft-fg"
            }`}
          >
            <n.icon className="h-[26px] w-[26px]" strokeWidth={1.7} />
          </span>
          <div className="font-serif text-[1.12rem] font-semibold">{n.name}</div>
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-faint">
            {n.num}
          </span>
        </div>
      ))}
      <div className="absolute left-1/2 top-1/2 grid h-32 w-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[radial-gradient(closest-side,var(--accent-soft),transparent)] text-center">
        <div>
          <span className="mx-auto mb-1.5 flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-brand-600 text-base font-extrabold text-white">
            i
          </span>
          <small className="font-mono text-[0.58rem] uppercase tracking-[0.14em] text-faint">
            compounds
          </small>
        </div>
      </div>
    </div>
  );
}

/* ── Colocated CSS for the few effects Tailwind can't express ─ */

function PageStyle() {
  return (
    <style>{`
      @media (prefers-reduced-motion: no-preference){ html{ scroll-behavior:smooth } }
      @keyframes lp-spin{ to{ transform:rotate(360deg) } }
      @keyframes lp-blink{ 50%{ opacity:0 } }
      @keyframes lp-in{ from{ opacity:0; transform:translateY(12px) } to{ opacity:1; transform:none } }
      .lp-sweep{
        position:absolute; inset:0; border-radius:9999px;
        background: conic-gradient(from 0deg, transparent 0 62%, var(--accent) 82%, transparent 100%);
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 24px), #000 calc(100% - 23px));
                mask: radial-gradient(farthest-side, transparent calc(100% - 24px), #000 calc(100% - 23px));
        animation: lp-spin 7s linear infinite; opacity:.8;
      }
      .lp-cursor{ display:inline-block; width:2px; height:1.05em; vertical-align:-2px; margin-left:1px; background: var(--accent); animation: lp-blink 1.1s step-end infinite }
      .lp-fade{ animation: lp-in .7s cubic-bezier(.2,.7,.2,1) both }
      @media (prefers-reduced-motion: reduce){
        .lp-sweep, .lp-cursor, .lp-fade{ animation:none }
      }
    `}</style>
  );
}
