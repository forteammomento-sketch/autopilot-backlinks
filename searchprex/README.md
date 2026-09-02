# @searchprex/core

Engine adapters and citation analysis for the **AI Visibility Autopilot** feature.
Spec: [`../strategy/searchprex-ai-visibility-autopilot.md`](../strategy/searchprex-ai-visibility-autopilot.md).

V0 so far: two engine adapters, the site crawler that gathers evidence, the gap
detector that turns an uncited prompt into a typed finding, the Action Engine
that turns findings into artifacts, and the deploy pipeline that ships them as
a reviewable pull request.
Framework-free — no Next.js imports — so it drops into `lib/` of the app
unchanged.

The default project is the MSO storefront (`https://www.michigansportsoutdoor.com/`),
configured in [`scripts/projects.ts`](scripts/projects.ts).

## Install

```bash
npm install
npm test          # 167 unit tests, no network
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
src/actions/rank.ts         priority = leverage x certainty x value / effort
src/actions/artifacts.ts    deterministic builders (robots, schema, links)
src/actions/answer-block.ts model-backed copy, with validation and refusal
src/actions/generate.ts     gap -> action orchestration
src/deploy/markers.ts       fenced, idempotent, removable block markers
src/deploy/apply.ts         pure HTML/robots patching
src/deploy/plan.ts          actions -> reviewable file changes
src/deploy/github.ts        pull request deploy + revert
src/deploy/rest-client.ts   GitHub REST implementation
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

## The Action Engine

```ts
const outcomes = await generateActions(detections, {
  brandName: 'Michigan Sports Outdoor',
  facts,          // the first-party fact sheet
  writer,         // your LLM, behind the AnswerBlockWriter interface
});
```

Each outcome is either an `action` carrying a deployable artifact, or a
`refusal` naming what would unblock it. Both go in the queue — a refusal is
information the customer needs, not an error to swallow.

### Most of it needs no model

| Action | Built by |
|---|---|
| `crawl_fix` | code — a robots.txt allow group, or a WAF instruction |
| `schema` | code — JSON-LD from the page and the fact sheet |
| `internal_link` | code — anchors from the prompt, sources from the crawl |
| `placement` | code — targets from the citation graph; pitch optional |
| `rank_first` | nothing — advisory, deliberately has no artifact |
| `answer_block` | your model, behind `AnswerBlockWriter` |

Generating a robots.txt line with an LLM would add cost, latency and a
fabrication risk to work that has exactly one correct answer.

**Schema omits rather than invents.** A price reaches `offers` only when a price
fact was supplied: Product markup carrying a price the page does not show is a
structured-data violation and a manual-action risk.

### Refusal is a first-class output

`answer_block` is the only generated action, and it refuses in four cases:

- **`no_first_party_facts`** — nothing of our own to say about this prompt. Any
  block would restate the competitor page that is already cited, adding a
  near-duplicate passage to a site that likely already has a duplication
  problem. The writer is never even called.
- **`validation_failed`** — the draft came back outside the 40-90 word band, or
  used none of the supplied facts. One retry, then refuse.
- **`duplicate_of_existing`** — the draft reproduces the rival passage or a
  block already deployed here.
- **`not_retrievable`** — the blocking gap is at gate 1 or 2, so no copy will
  get the page retrieved. `no_page` is exempt: it sits at gate 1, but writing
  the page is its remedy.

The duplicate check uses shingle **containment**, not Jaccard. Jaccard divides
by the union, so a block that reproduces the rival passage verbatim and pads it
with one extra sentence scores around 0.5 and passes — which is exactly the
failure the check exists to catch. Containment divides by the shorter side, so
full reuse scores 1 however much filler wraps it. Pass a pgvector cosine through
`options.similarity` once embeddings are wired; containment cannot see a
paraphrase that shares no wording.

### The ranker

```
priority = leverage x certainty x prompt_value x engine_weight x win_rate / effort
```

`certainty` is where `strong` and `plausible` get discounted, so a hypothesis
never outranks a proven lever. `win_rate` defaults to 0.5 — an explicit "no
record yet" rather than an optimistic guess — and converges as
`lift_measurements` fills.

## The deploy pipeline

```ts
const plan = await buildDeployPlan(approvedActions, { resolver, readFile });
// review plan.changes — before/after per file — then:
const record = await deployViaPullRequest(plan, client);
// and if it goes wrong:
await rollbackViaPullRequest(record, client);
```

V0 ships `answer_block`, `schema` and `crawl_fix` through a **draft pull
request**. Not a direct commit, not the default branch: this writes generated
copy into someone's production site, and the diff is the only place a human sees
exactly what changed before it goes live.

### Everything written is fenced and removable

```html
<!-- searchprex:block:3f2a91c4 -->
<section class="sp-answer">…</section>
<!-- /searchprex:block:3f2a91c4 -->
```

This is what makes a second deploy **replace** a block rather than append a
second copy — a customer who approves the same action twice would otherwise end
up with duplicate passages, the precise failure this product exists to prevent.
It also means the block can be removed by anyone holding the page, not only by
reverting our commit.

### Where a block lands

Tried in order: an existing marked block, then before `</main>`, then before the
footer, then before `</body>`. A block appended after the footer is in the DOM
but outside the region extractors treat as the page body — the action would be
spent for nothing.

### What the pipeline refuses to do

- **Add a second JSON-LD block of a type the page already has.** Two competing
  Product blocks is worse than none: engines pick one unpredictably, and the
  conflict is one we created.
- **Rewrite a robots.txt group somebody already configured.** That group exists
  for a reason we cannot see, possibly a legal one. It appends a new allow
  group, or it reports and stops.
- **Overwrite a file that changed between planning and deploying.** The deploy
  compares against the snapshot and throws rather than clobbering whatever
  landed in between.
- **Publish unlimited blocks in one push.** `maxBlocksPerRun` defaults to 5.
  Dozens of generated passages appearing across a domain at once is the shape
  that trips spam classification, and that damage lands on the whole site rather
  than the pages we touched. Held-back blocks are named in the PR body.

### Rollback

`before` is captured for every file *before* anything is written, and rollback
opens a revert PR from those snapshots. Not a force-push or a branch delete: the
original PR may already be merged, and rewriting history under a team that has
pulled it does more damage than the change being undone.

### Mapping URLs to files

`staticSiteResolver` handles a site whose URLs mirror its file tree. Any
framework with its own routing needs its own resolver — the default returns
`null` rather than guessing, because a wrong guess writes a block into the wrong
file.

## Not built yet

Prompt generation, the T+14 re-measure job, the Shopify / WordPress / Webflow
deploy targets, and the Gemini / AI Overviews / Copilot adapters. Adding an engine means
implementing `EngineAdapter` — nothing downstream of `analyseResult` is
engine-specific.

`js_only` detection needs a rendered word count, which means a headless
browser. `buildSiteEvidence` takes an optional `renderer` hook for that; without
one wired, `js_only` is simply not reported rather than guessed at.
