# Searchprex — AI Visibility Autopilot

**Feature spec & build plan**
**Prepared for:** Mubashar Shahzad
**Stack:** Next.js (App Router) + Supabase/Postgres
**Date:** 2 September 2026
**Status:** spec — not yet built

---

## 0. What this feature is, in one paragraph

Searchprex takes a domain and a topic, works out which prompts in that topic
get answered by ChatGPT, Perplexity, Google AI Overviews and Gemini **without
citing the customer**, and then does the work that gets them cited — generating
answer-shaped content blocks, schema, crawler access fixes, and a ranked list of
third-party pages to get placed on — pushing those changes live, and re-running
the same prompts two weeks later to prove the citation appeared.

**The product is the doing, not the dashboard.** Every screen must end in a
button that changes something on the customer's site or in the citation graph.

### What we are deliberately not building

| Not building | Why |
|---|---|
| Another "AI rank tracker" | Peec, Profound, Otterly, Semrush AI Toolkit already do this. Tracking is a $49/mo commodity and it does not move the number. |
| A share-of-voice chart as the headline metric | It is a lagging metric users cannot act on. We show it, we do not sell it. |
| Scraping chatgpt.com / perplexity.ai UIs | ToS violation, bot-detection arms race, and it is the part of the stack most likely to get the company sued. Official APIs only — see §8. |

Tracking exists inside this feature only as the **measurement loop** that closes
the cycle. It is the ruler, not the product.

---

## 1. The mechanism — how a page becomes an AI answer

Every AI answer engine, whatever the branding, runs the same four gates. A page
that fails any one of them cannot be cited, no matter how good it is. The whole
product is built on moving pages through these gates.

```
  Gate 1: RETRIEVABLE   →  Gate 2: RANKED     →  Gate 3: EXTRACTABLE  →  Gate 4: CORROBORATED
  Can the engine's          Does it surface       Is there a clean,       Do other sources the
  crawler fetch it and      in the top ~10-20     self-contained          engine trusts say the
  is it in the index?       classic results       passage that answers    same thing about you?
                           for the query the      the question in
                           engine fires?          40-90 words?
```

**Gate 2 is the one nobody wants to hear.** AI Overviews, ChatGPT search and
Perplexity overwhelmingly cite pages that already rank on page one for a related
classic query. There is no separate "AI ranking" ladder to climb around
traditional SEO — AI visibility is *conditional on* organic visibility, then
gated further by extractability and corroboration.

This has a direct product consequence: **Searchprex must refuse to sell hope.**
If a customer's page is at position 40, the honest action is "fix the ranking
first", and the product should say so rather than generating a FAQ block that
will never be retrieved. That refusal is a feature — it is what separates us
from the tools that generate content into a void.

---

## 2. The five levers, ranked

Ranked by **leverage × automatability**. Certainty labels are deliberate: we
encode what is proven separately from what is plausible, and we show the label
in the UI next to every recommendation.

| # | Lever | Gate | Leverage | Can we automate it? | Certainty |
|---|---|---|---|---|---|
| 1 | **Answer-block rewriting** — self-contained Q→A passages with specifics | 3 | High | Fully | **Proven.** Extraction is passage-level; every engine's retriever is chunk-based. |
| 2 | **Third-party source placement** — get onto the pages AI already cites | 4 | Highest | Semi (we find + draft, human places) | **Proven.** Citation sets are dominated by listicles, comparison pages, Reddit, YouTube, review sites — not brand sites. |
| 3 | **Crawler access + render fixes** — AI bot allowances, HTML-first content | 1 | Medium, binary | Fully | **Proven.** A blocked or JS-only page is not a candidate at all. |
| 4 | **Entity & structured data** — Organization/Product/FAQ schema, sameAs, consistent naming | 3 | Medium | Fully | **Strong signal, not confirmed as a ranking input.** Improves disambiguation and shopping surfaces. Label it honestly. |
| 5 | **Freshness + original data** — dateModified, first-party stats worth quoting | 3/4 | Medium | Semi | **Plausible.** Original numbers get cited disproportionately, but the causal evidence is thin. |

### On `llms.txt`

Ship it — it costs one route handler. But no major engine has confirmed reading
it, and we must not put it in the "proven" column or bill for it as a lever. It
is a hygiene checkbox, not a growth mechanism. Any competitor selling `llms.txt`
as a primary lever is selling a hypothesis.

### On lever 2 — this is the moat

Levers 1, 3 and 4 are on-page and every competitor will ship them within a year.
Lever 2 is the defensible one, and it is also the one this repo is already named
after. The pipeline is:

```
run prompt → collect the 8-15 cited URLs → strip the customer's own domain
          → cluster the remaining domains by how often they are cited across
            the whole prompt set
          → THAT list is the customer's placement target list, ranked by
            observed AI-citation frequency rather than by DR
```

Nobody sells a link target list built from "pages AI actually cites for your
prompts." That is a genuinely new artifact and it falls out of the measurement
loop for free.

---

## 3. The product loop

```
    ┌──────────────────────────────────────────────────────────────┐
    │                                                              │
    │   1. DIAGNOSE            2. GENERATE           3. DEPLOY     │
    │   ──────────             ──────────            ────────      │
    │   Build prompt set       Gap → typed Action    Push to CMS   │
    │   Run all engines        LLM drafts the        or JS snippet │
    │   Parse citations        artifact              Track deploy  │
    │   Diff vs competitors    Human approves        commit         │
    │        │                      │                    │         │
    │        └──────────────────────┴────────────────────┘         │
    │                               │                              │
    │                    4. RE-MEASURE (T+14d)                     │
    │                    Same prompts, same engines.               │
    │                    Did the citation appear?                  │
    │                    Feed win/loss back into the               │
    │                    action ranker.                            │
    │                               │                              │
    └───────────────────────────────┘                              │
```

Step 4 is what makes it a product and not a report. **The win/loss record per
action type is the asset** — after 200 customers we know empirically which
action types produce citations in which verticals, and the ranker stops being a
guess. No competitor has that data yet.

---

## 4. Feature surface — the screens

| Screen | Route | What it does |
|---|---|---|
| **Setup** | `/p/[project]/setup` | Domain, 3–5 competitors, topic seed. One-time. |
| **Prompt Universe** | `/p/[project]/prompts` | Generated prompt set, editable. Grouped by intent: informational / comparison / commercial / brand. |
| **Visibility** | `/p/[project]` | The scoreboard. Per engine: cited / not cited / competitor cited. Sorted by *fixability*, not by volume. |
| **Actions** ⭐ | `/p/[project]/actions` | **The main screen.** Ranked queue of typed actions with the generated artifact attached and an Approve → Deploy button. |
| **Placements** | `/p/[project]/placements` | The citation-graph target list (lever 2) with a drafted pitch per target. |
| **Proof** | `/p/[project]/proof` | Before/after per deployed action. Citation appeared: yes/no/pending. This screen renews the subscription. |

The Actions screen is the product. If a user only ever opens one screen, it is
that one, and it must be openable without going through Visibility first.

---

## 5. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router (Vercel)                                    │
│  ├── app/(dash)/p/[project]/...      RSC, reads Supabase direct │
│  ├── app/api/webhooks/...            Inngest, Shopify, Stripe   │
│  └── app/api/snippet/[key]/route.ts  edge — serves JS snippet   │
└──────────────┬──────────────────────────────────────────────────┘
               │
┌──────────────▼──────────────┐     ┌──────────────────────────────┐
│  Inngest (job orchestration) │────▶│  Engine adapters             │
│  ├── prompts.generate        │     │  ├── openai-search           │
│  ├── run.fanout   (1/prompt  │     │  ├── perplexity-sonar        │
│  │                 ×engine)  │     │  ├── gemini-grounded         │
│  ├── citations.parse         │     │  ├── aio-serp (3rd party)    │
│  ├── gaps.compute            │     │  └── copilot (via Bing SERP) │
│  ├── actions.generate        │     └──────────────────────────────┘
│  ├── deploy.push                    ┌──────────────────────────────┐
│  └── remeasure.schedule (T+14d)────▶│  Deploy targets              │
└──────────────┬──────────────┘       │  Shopify Admin API           │
               │                      │  WordPress REST              │
┌──────────────▼──────────────┐       │  Webflow CMS                 │
│  Supabase                   │       │  JS snippet (fallback)       │
│  Postgres + RLS per org     │       │  GitHub PR (dev-mode sites)  │
│  Storage: raw engine JSON   │       └──────────────────────────────┘
│  pgvector: chunk dedupe     │
└─────────────────────────────┘
```

### Why Inngest and not Supabase Edge Functions + pg_cron

A single project run is `prompts × engines` = 60 × 5 = **300 API calls**, each
2–20 seconds, each needing independent retry and rate-limit backoff. That is a
fan-out/fan-in durable workflow. Edge Functions cap out at 150s and pg_cron
gives no retry semantics or step-level observability. Inngest's `step.run` +
concurrency limits per engine key is a two-day integration versus two weeks of
building a queue.

Alternative if you want zero new vendors: Supabase **pgmq** + a long-running
worker on Fly.io/Railway. More control, more code. Take Inngest for V0.

### Multi-tenancy

RLS on every table keyed to `org_id`, derived from `auth.jwt()`. Server-side
jobs use the service-role key and set `org_id` explicitly — never trust the
job payload alone; re-verify project ownership at the top of every job step.

---

## 6. Data model

```sql
-- ── tenancy ────────────────────────────────────────────────────────────
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'trial',
  created_at timestamptz default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs on delete cascade,
  domain text not null,
  brand_names text[] not null default '{}',  -- aliases for mention matching
  topic text not null,
  cms_kind text,                             -- shopify | wordpress | webflow | snippet | github
  cms_credentials_ref text,                  -- Vault key, never the token itself
  created_at timestamptz default now()
);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  domain text not null,
  brand_names text[] not null default '{}'
);

-- ── the prompt universe ────────────────────────────────────────────────
create table prompts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  text text not null,
  intent text not null check (intent in ('informational','comparison','commercial','brand')),
  cluster text,
  is_active boolean not null default true,
  source text not null default 'generated'   -- generated | user | gsc_import
);

-- ── measurement ────────────────────────────────────────────────────────
create table runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  kind text not null default 'scheduled',    -- scheduled | baseline | remeasure
  triggered_by_action_id uuid,               -- set when kind='remeasure'
  started_at timestamptz default now(),
  finished_at timestamptz
);

create table run_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs on delete cascade,
  prompt_id uuid not null references prompts on delete cascade,
  engine text not null,                      -- openai | perplexity | gemini | aio | copilot
  answer_text text,
  raw_ref text,                              -- Supabase Storage path to full JSON
  brand_mentioned boolean not null default false,
  brand_cited boolean not null default false,-- mentioned AND linked in citation set
  mention_rank int,                          -- 1-based order of first brand mention
  sentiment text,                            -- positive | neutral | negative
  error text,
  created_at timestamptz default now(),
  unique (run_id, prompt_id, engine)
);

create table citations (
  id uuid primary key default gen_random_uuid(),
  run_result_id uuid not null references run_results on delete cascade,
  position int not null,
  url text not null,
  domain text not null,
  title text,
  owner text not null                        -- self | competitor | third_party
);
create index on citations (domain);

-- ── the citation graph → placement targets (lever 2) ───────────────────
create materialized view placement_targets as
select
  p.project_id,
  c.domain,
  count(distinct rr.prompt_id)          as prompts_covered,
  count(*)                              as citation_count,
  array_agg(distinct c.url order by c.url) filter (where c.owner='third_party') as urls
from citations c
join run_results rr on rr.id = c.run_result_id
join prompts p      on p.id  = rr.prompt_id
where c.owner = 'third_party'
group by p.project_id, c.domain;

-- ── action engine ──────────────────────────────────────────────────────
create table gaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  prompt_id uuid not null references prompts on delete cascade,
  engine text not null,
  gap_type text not null,      -- see §7 rules table
  blocked_at_gate int not null check (blocked_at_gate between 1 and 4),
  our_url text,                -- best candidate page we own, if any
  rival_url text,              -- what got cited instead
  evidence jsonb not null,
  detected_at timestamptz default now()
);

create table actions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  gap_id uuid references gaps on delete set null,
  action_type text not null,   -- answer_block | schema | crawl_fix | internal_link
                               -- | placement | rank_first (advisory)
  target_url text,
  priority numeric not null,   -- ranker output, see §7
  status text not null default 'draft',
                               -- draft | approved | deployed | verified | failed | rejected
  artifact jsonb,              -- generated HTML / JSON-LD / robots diff / pitch email
  certainty text not null,     -- proven | strong | plausible
  created_at timestamptz default now()
);

create table deployments (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions on delete cascade,
  method text not null,        -- shopify | wordpress | webflow | snippet | github_pr
  external_ref text,           -- Shopify metafield id, WP post id, PR url…
  before_snapshot text,        -- Storage path — required, this is the undo
  deployed_at timestamptz default now(),
  rolled_back_at timestamptz
);

create table lift_measurements (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions on delete cascade,
  baseline_run_id uuid not null references runs,
  followup_run_id uuid references runs,
  cited_before boolean not null,
  cited_after boolean,
  measured_at timestamptz
);
```

`lift_measurements` is the table that trains the ranker in §7 and fills the
Proof screen. Do not defer it to V1 — without it, V0 has nothing to renew on.

---

## 7. The Action Engine

For every `(prompt, engine)` where the brand is not cited, classify the gap by
the gate it failed, then emit a typed action.

| Gap type | Detection | Action emitted | Automatable | Certainty |
|---|---|---|---|---|
| `bot_blocked` | robots.txt disallows `GPTBot`/`OAI-SearchBot`/`PerplexityBot`/`ClaudeBot`, or WAF 403s them | `crawl_fix` — robots diff + WAF allowlist note | Full | proven |
| `js_only` | HTML fetch has < 200 words of body text but rendered DOM has > 800 | `crawl_fix` — SSR/prerender the answer block | Full | proven |
| `no_page` | No owned URL is topically close to the prompt | `answer_block` — new page brief + drafted block | Full | proven |
| `weak_passage` | We own a close page, but no ≤ 90-word self-contained answer exists | `answer_block` — rewrite in place | Full | proven |
| `no_schema` | Page lacks Product/FAQPage/Organization JSON-LD | `schema` — generated valid JSON-LD | Full | strong |
| `orphan` | Owned page has < 3 internal inbound links | `internal_link` — source pages + anchors | Full | strong |
| `rival_corroborated` | ≥ 3 third-party cited domains mention rival, none mention us | `placement` — target list + drafted pitch | Semi | proven |
| `not_ranking` | Owned page exists, is fine, but ranks > 20 classically | `rank_first` — **advisory only, no content generated** | No | proven |

### The ranker

```
priority = leverage(action_type)          -- §2 table, 1-5
         × certainty_weight               -- proven 1.0 | strong 0.7 | plausible 0.4
         × prompt_value                   -- commercial 3 | comparison 2 | informational 1
         × engine_weight                  -- customer's actual traffic mix
         × historical_win_rate(action_type, vertical)   -- from lift_measurements
         ÷ effort(action_type)            -- crawl_fix 1 … placement 5
```

`historical_win_rate` defaults to 0.5 with no data and converges as
`lift_measurements` fills. This is the flywheel: every customer's results make
the next customer's queue smarter, and it is not copyable by a competitor
launching later.

### The generation prompt shape (answer_block)

Not "write an FAQ." The generator gets: the exact user prompt, the rival's
cited passage, our page's existing content, and the brand's factual sheet. It
must return a block that is:

- **Self-contained** — answers without needing the surrounding page
- **40–90 words** for the direct answer, then specifics beneath
- **Specific** — numbers, names, prices, dates. Generic prose is not extracted
- **Attributable** — states the brand as the source of the claim
- **Non-duplicative** — pgvector check against every block already deployed for
  this project, cosine > 0.92 = regenerate

> **A hard rule, learned from smkstore.com:** a generated block that says
> nothing the rival page does not already say is worse than no block. It adds a
> near-duplicate passage to a site that already has a duplication problem.
> The generator must be given first-party facts — stock, fitment, warranty,
> shipping, real specs — or it must refuse and open a `rank_first` advisory
> instead. **Refusal-to-generate has to be a first-class output of this engine.**

---

## 8. Engine adapters

One interface, five implementations:

```ts
type EngineResult = {
  answerText: string;
  citations: { position: number; url: string; title?: string }[];
  raw: unknown;
};
interface EngineAdapter {
  key: 'openai' | 'perplexity' | 'gemini' | 'aio' | 'copilot';
  query(prompt: string, opts: { locale: string }): Promise<EngineResult>;
}
```

| Engine | How | Citations available? | Notes |
|---|---|---|---|
| **ChatGPT search** | OpenAI Responses API with the `web_search` tool | Yes — URL annotations on the message | Officially supported. Not identical to consumer chatgpt.com output; disclose that in the UI. |
| **Perplexity** | Sonar API | Yes — `citations[]` in the response | Cleanest adapter of the five. |
| **Gemini** | Gemini API with Google Search grounding | Yes — `groundingMetadata` | Grounding redirect URIs need resolving to real URLs. |
| **Google AI Overviews** | Third-party SERP API (SerpApi / DataForSEO / Serper) | Yes — AIO block with source links | **No official API exists.** Vendor dependency, per-query cost, and AIO does not fire on every query — record "not triggered" as a distinct state, never as "not cited". |
| **Copilot** | Bing SERP via the same SERP vendor | Partial | Lowest fidelity. Ship last, or omit from V0 and say so. |

**Compliance line, non-negotiable:** no headless-browser scraping of
`chatgpt.com`, `perplexity.ai` or `gemini.google.com`. It breaches their terms,
it will break weekly, and it makes the company un-sellable. Where only a SERP
vendor can reach a surface, we pay the vendor and it becomes a line item.

**Non-determinism:** these models return different answers to the same prompt.
A single run is noise. Run each `(prompt, engine)` **3×** and store all three;
report `cited_in_n_of_3`. Anyone reporting single-run results is reporting
noise, and a customer who checks manually will catch it.

---

## 9. Deploy pipeline

Ranked by how much we can guarantee:

1. **GitHub PR** — for sites in a repo. Highest trust, full diff, their review.
2. **Shopify Admin API** — metafields + theme block. Reversible.
3. **WordPress REST** — post content patch, revision kept automatically.
4. **Webflow CMS API** — collection item field patch.
5. **JS snippet** (`/api/snippet/[key]`) — last resort.

### On the snippet, from experience

You already injected content into smkstore.com by script and Google declined to
index it. Two things went wrong and both must be designed against here:

- **Client-injected content is rendered late or not at all** by the engines that
  matter, and AI crawlers are worse at JS than Googlebot is. Content that only
  exists after hydration frequently does not exist for the retriever.
- **Injected boilerplate across many pages compounds a duplication problem**
  rather than solving one.

So: the snippet is offered, but the UI must state plainly that snippet-injected
blocks measure worse than server-rendered ones, and the Proof screen must
segment lift by deploy method so the customer sees it in their own data. If our
own numbers show snippet deploys underperform, we say so — that honesty is
worth more than the deploys we lose.

Every deployment writes a `before_snapshot` **before** it writes anything.
One-click rollback is a V0 requirement, not a V1 nicety.

---

## 10. Proving lift

The Proof screen, per deployed action:

```
  Action:    answer_block → /products/rough-rider-barlow
  Deployed:  12 Sep 2026 · GitHub PR #418
  Prompt:    "best budget barlow knife under $40"

              Perplexity   ChatGPT   AI Overview   Gemini
  Before        ✗            ✗          ✗            ✗
  After (T+14)  ✓ (3/3)      ✓ (2/3)    not fired    ✗

  Net: cited by 2 of 4 engines · first citation 6 days after deploy
```

Roll up to a single headline number: **"Citations gained in the last 30 days:
14."** That is the renewal metric. Share of voice is a secondary chart.

---

## 11. Cost model (per project, per month)

Assumptions: 60 prompts, 5 engines, 3 repeats, weekly runs.

```
runs/month          = 60 × 5 × 3 × 4  = 3,600 engine calls
```

| Line | Est. monthly |
|---|---|
| OpenAI + Perplexity + Gemini (~2,160 calls, grounded) | $25–45 |
| SERP vendor for AIO + Copilot (~1,440 calls) | $30–70 |
| Action generation (~80 artifacts × long context) | $10–20 |
| Supabase + Vercel + Inngest amortised | $5–10 |
| **Total** | **≈ $70–145** |

Implications:
- **Weekly is the default cadence, not daily.** Daily quadruples COGS for no
  decision-making benefit — nobody acts on daily AI-citation noise.
- Prompt count must be plan-capped; it is the main cost driver.
- Price floor is **$149/mo**; the target tier is $349–499 for 3 projects.
- Cache aggressively by `(prompt, engine, day)` — several customers in one
  vertical will fire overlapping prompts and each cache hit is pure margin.

---

## 12. Roadmap

### V0 — "Gap to Fix", 4 weeks

Ship the loop end-to-end for **one** vertical (e-commerce/Shopify) and **two**
engines (Perplexity + ChatGPT search — the two with clean official APIs).

- [ ] Setup → prompt generation (40 prompts, editable)
- [ ] Two engine adapters, 3× repeat, citation parsing
- [ ] Gap detection for 4 types: `bot_blocked`, `weak_passage`, `no_schema`, `rival_corroborated`
- [ ] Action generation for `answer_block` + `schema` + `crawl_fix`
- [ ] Deploy via **GitHub PR only** (highest trust, lowest support burden)
- [ ] Auto re-measure at T+14, Proof screen
- [ ] Rollback

Deliberately excluded from V0: AI Overviews, Copilot, Gemini, placements,
snippet deploy, Shopify/WP/Webflow. **Ship the loop, not the surface area.**

### V1 — "Placements", +4 weeks

- [ ] `placement_targets` view surfaced with drafted outreach per target
- [ ] Gemini + AI Overviews adapters (adds the SERP-vendor dependency)
- [ ] Shopify + WordPress deploy
- [ ] `historical_win_rate` goes live in the ranker

### V2 — "Autopilot", +6 weeks

- [ ] Auto-approve rules ("deploy any `proven` action under 200 words")
- [ ] Competitor citation alerts
- [ ] GSC join — correlate AI citations with real impression/click movement
- [ ] Multi-locale prompt sets

---

## 13. Risks and honest unknowns

| Risk | Reality | Mitigation |
|---|---|---|
| Engines change output format | Certain. Happens quarterly. | Adapters isolated behind one interface; store raw JSON so historical runs are re-parseable. |
| AI Overviews has no official API | Certain | Vendor abstraction over ≥ 2 SERP providers; treat as a cost line, never as an SLA. |
| Answer non-determinism read as "lift" | High | 3× repeat, report `n/3`, never claim lift on a 1/3 → 2/3 move. |
| Google ships an official AI-citation report in Search Console | Plausible within 12 months | It would commoditise measurement — which is exactly why the product's value must sit in §2 lever 2 and the win-rate data, not in the ruler. |
| Generated content triggers spam classification | Real | Refusal-to-generate rule in §7, pgvector dedupe, human approval gate in V0/V1, and a hard cap on blocks deployed per domain per week. |
| Customer's real problem is classic ranking | **Very common** | `rank_first` advisory. The product tells them the truth and does not bill them for content that cannot be retrieved. |

The largest unknown is honest to state plainly: **nobody, including us, has
causal proof of what makes an AI engine cite a page.** The correlations in §2
are strong and the gate model is sound, but the industry is running on
inference. This is precisely why `lift_measurements` is in V0 — within six
months of live customers, Searchprex will hold the causal evidence the rest of
the market is guessing at. That dataset, not the dashboard, is the company.

---

## 14. First three things to build

1. `EngineAdapter` for Perplexity Sonar + the `citations` parser. Half a day,
   and it makes the rest of the spec concrete.
2. The gap classifier on a hardcoded 20-prompt set for one real domain — run it
   against michigansportsoutdoor.com and read the output yourself. If the gaps
   it finds are not ones you would have found manually, the model in §1 is
   wrong and needs fixing before any UI is built.
3. `lift_measurements` + the T+14 re-measure job. Build the ruler before the
   thing being measured, or you will ship a content generator with no evidence
   it works.
