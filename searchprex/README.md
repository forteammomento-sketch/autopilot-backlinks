# @searchprex/core

Engine adapters and citation analysis for the **AI Visibility Autopilot** feature.
Spec: [`../strategy/searchprex-ai-visibility-autopilot.md`](../strategy/searchprex-ai-visibility-autopilot.md).

V0 so far: two engine adapters, the site crawler that gathers evidence, and the
gap detector that turns an uncited prompt into a typed, evidenced finding.
Framework-free — no Next.js imports — so it drops into `lib/` of the app
unchanged.

The default project is the MSO storefront (`https://www.michigansportsoutdoor.com/`),
configured in [`scripts/projects.ts`](scripts/projects.ts).

## Install

```bash
npm install
npm test          # 118 unit tests, no network
npm run typecheck
```

## Live check

Unit tests stub `fetch`, which proves the parsing but not that Perplexity
accepts our request body. After any change to the request shape:

```bash
PERPLEXITY_API_KEY=pplx-... npm run smoke "best budget barlow pocket knife under $40"
ENGINE=openai OPENAI_API_KEY=sk-... npm run smoke "best budget barlow pocket knife"
```

Spends 3 API calls and prints the citation breakdown per attempt.

## What's here

```
src/engines/types.ts        EngineAdapter contract — one call per query()
src/engines/errors.ts       EngineError + retryable/non-retryable split, backoff
src/engines/perplexity.ts   Sonar adapter
src/engines/openai.ts       ChatGPT search, via Responses API + web_search tool
src/lib/domain.ts           eTLD+1 normalisation for citation matching
src/lib/brand.ts            brand mention detection in answer text
src/lib/citations.ts        self / competitor / third_party classification
src/lib/robots.ts           robots.txt parser + which crawlers each engine needs
src/lib/html.ts             visible text, JSON-LD, snippet suppression, passages
src/runner/sample.ts        3x repeat + retry, verdict aggregation
src/crawl/fetcher.ts        capped, polite HTTP + a concurrency pool
src/crawl/sitemap.ts        urlset / sitemapindex parsing
src/crawl/links.ts          internal links, canonical, title, h1
src/crawl/crawl.ts          discovery, inbound-link counting, crawler probing
src/crawl/evidence.ts       candidate selection -> SiteEvidence
src/gaps/detect.ts          gap detection across the four gates
supabase/migrations/        V0 schema with RLS
```

## The crawler

```bash
npm run crawl -- "" "how long does a pocket knife blade stay sharp"
PROBE=1 npm run crawl -- "" "..."      # also probe for edge-level blocking
MAX_PAGES=200 npm run crawl -- smkstore.com "..."
```

Discovery prefers the sitemaps named in robots.txt and falls back to following
homepage links. Everything is capped — pages, bytes, timeout, concurrency — and
a `Crawl-delay` drops concurrency to one: a crawl runs against a customer's
production store, where a runaway loop is not a slow job but an outage they pay
for and blame on us.

**The crawler obeys robots.txt for its own agent.** A tool that audits crawler
access while ignoring robots.txt itself has no standing to report the finding.

### Edge blocking (`PROBE=1`)

robots.txt is only half of gate 1. CDNs now block AI crawlers at the edge by
default, so a site can have a permissive robots.txt and still return 403 to
`OAI-SearchBot`. That is invisible to a normal fetch and is one of the most
common causes of an otherwise healthy page never being cited.

Probing sends another company's user-agent string, which is only defensible
against a site the customer owns and has asked us to audit — so the probe URL
is built from the project's own origin and structurally cannot be pointed
elsewhere. A 403 only counts as a block when the same request from our own
agent succeeded; a site that is down for everyone is a different problem.

## The gap detector

`detectGaps(sampled, context, evidence)` returns every applicable gap ordered by
gate, plus `blocking` — the earliest one. **Only `blocking` should produce a
content action.** Generating an answer block for a page robots.txt disallows is
work that cannot pay off, and shipping it anyway spends the customer's content
budget and their trust at the same time.

| Gate | Gap types | Certainty |
|---|---|---|
| 1 retrievable | `bot_blocked`, `js_only`, `no_page` | proven |
| 2 ranked | `not_ranking` (advisory — no content generated) | proven |
| 3 extractable | `weak_passage` (proven), `no_schema`, `orphan` | proven / strong |
| 4 corroborated | `rival_corroborated` | proven |

Two verdicts produce **no gaps at all**: `cited` (nothing to fix) and `unknown`
(every call failed — an outage is not evidence of absence, and inventing work
from one is worse than reporting nothing). `contested` does produce gaps: cited
one time in three is a weakness, not a win.

### Two crawler facts the detector encodes

Both are commonly got wrong, including by tools that sell this check:

- **GPTBot is training-only.** ChatGPT search retrieves with `OAI-SearchBot`
  and fetches live pages as `ChatGPT-User`. A blocked GPTBot is not an
  AI-search gap, and reporting it as one sends the customer to reopen a legal
  decision for zero visibility gain.
- **Google-Extended does not control AI Overviews.** It governs Gemini
  grounding and training. AI Overviews runs off the ordinary Googlebot crawl
  and has no separate opt-out — the only levers are `nosnippet`, `max-snippet`
  and `data-nosnippet`, which also cost the ordinary search snippet. The
  detector therefore checks snippet suppression for `aio` and `gemini` only.

## Three decisions worth knowing before you extend this

**The adapter sends no system prompt, no temperature and no domain filter.**
Each of those would improve the answer and invalidate the measurement — we are
recording what an unprimed buyer sees, not what we can coax out of the model.
If some other surface needs a steered answer, that is a different adapter.

**One prompt is asked three times.** These models answer identically-worded
prompts differently. A single call is a sample of size one, so the runner
records `cited N of 3` and exposes `contested` as a first-class verdict
alongside `cited` and `absent`. Reporting a contested prompt as a clean win is
the fastest way to lose a customer who checks by hand.

**`answered: false` and "not cited" are different states,** as are `unknown`
(every call failed) and `absent` (calls succeeded, brand missing). Sonar always
answers so the distinction is dormant here, but AI Overviews frequently does not
fire, and collapsing that into "not cited" would manufacture gaps that were
never observed. The types enforce the split now so the AI Overviews adapter
cannot quietly lose it later.

## Not built yet

Prompt generation, the Action Engine (gap → generated artifact), deploys, and
the Gemini / AI Overviews / Copilot adapters. Adding an engine means
implementing `EngineAdapter` — nothing downstream of `analyseResult` is
engine-specific.

`js_only` detection needs a rendered word count, which means a headless
browser. `buildSiteEvidence` takes an optional `renderer` hook for that; without
one wired, `js_only` is simply not reported rather than guessed at.
