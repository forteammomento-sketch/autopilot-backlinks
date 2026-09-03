# @searchprex/core

Engine adapters and citation analysis for the **AI Visibility Autopilot** feature.
Spec: [`../strategy/searchprex-ai-visibility-autopilot.md`](../strategy/searchprex-ai-visibility-autopilot.md).

V0 so far: two engine adapters, the site crawler that gathers evidence, the gap
detector that turns an uncited prompt into a typed finding, the Action Engine
that turns findings into artifacts, the deploy pipeline that ships them as a
reviewable pull request, and the re-measure job that says whether any of it
worked.
Framework-free — no Next.js imports — so it drops into `lib/` of the app
unchanged.

The default project is the MSO storefront (`https://www.michigansportsoutdoor.com/`),
configured in [`scripts/projects.ts`](scripts/projects.ts).

## Run it

```bash
npm install
npm run dev       # dashboard at http://localhost:3000 -> /p/mso
npm test          # 351 tests, no network — including the migrations and the
                  # RLS policies, against real Postgres compiled to WebAssembly
npm run typecheck
```

With no environment set, the dashboard runs on fixture data
(`lib/data/fixtures.ts`) shaped exactly like what the pipeline produces. Set
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and it reads live data instead —
see `.env.example`.

The fallback is deliberate. A fresh clone should show a working dashboard, and a
half-configured environment should degrade to obviously-fake data rather than to
an empty screen a reader might mistake for "no gaps found".

## Live check

Unit tests stub `fetch`, which proves the parsing but not that Perplexity
accepts our request body. After any change to the request shape:

```bash
PERPLEXITY_API_KEY=pplx-... npm run smoke "best budget barlow pocket knife under $40"
ENGINE=openai OPENAI_API_KEY=sk-... npm run smoke "best budget barlow pocket knife"
OPENAI_API_KEY=sk-... npm run prompts        # generate a prompt set for review
```

Spends 3 API calls and prints the citation breakdown per attempt.

## What's here

```
src/engines/types.ts        EngineAdapter contract — one call per query()
src/engines/errors.ts       EngineError + retryable/non-retryable split, backoff
src/engines/perplexity.ts   Sonar adapter
src/engines/openai.ts       ChatGPT search, via Responses API + web_search tool
src/engines/gemini.ts       Gemini, with Google Search grounding
src/engines/serp.ts         AI Overviews and Bing's answer box, via a SERP vendor
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
src/deploy/shopify.ts       Shopify plan, apply and rollback
src/deploy/shopify-client.ts Shopify Admin REST client, rate-limit aware
src/measure/verify.ts       is the deploy actually live?
src/measure/lift.ts         direction, confidence, control-adjusted lift
src/measure/winrate.ts      lift records -> ranker input
src/measure/remeasure.ts    the T+14 job
supabase/migrations/        V0 schema with RLS
```

## Supabase

`npm test` applies every migration to a real Postgres (PGlite — Postgres in
WebAssembly) and then exercises it: views are planned and queried, constraints
are enforced, the lease functions run, and the cascades are checked. Migrations
are the one part of this system nothing else can verify. SQL that reads
correctly can still reference a column that does not exist, and the first time
anyone finds out is on a real database.

It has already earned itself. `v_project_summary` did not expose `cms_kind`, so
every project read as a git target — a Shopify store would have been offered
*Open draft pull request* for a write that goes straight to the live storefront,
exactly what the Shopify target exists to stop the UI saying. A view-contract
test now asserts every column the dashboard selects.

Screens read **views**, not tables — migration `0003_dashboard.sql`. A component
should not have to know that a prompt's text lives two joins from the action
addressing it, and keeping the joins in SQL means the query plan is tuned once.

That migration also fills two holes the original schema had: `actions` gained a
`rationale` column, and **refusals had nowhere to live at all**. That was a real
omission — a refusal naming the missing first-party fact is often the most
actionable row in the queue, and storing it nowhere meant the customer never saw
why nothing was generated.

Queries run with the service-role key, so RLS is bypassed and every query
filters by `project_id` explicitly. Losing that filter would leak one customer's
queue into another's dashboard.

### Row-level security

Tested as a **non-superuser**, because a superuser bypasses RLS entirely — a
test that queries as one passes against a database with no policies at all. Two
tenants are seeded with a full set of rows each and the assertion is that they
partition every table and view exactly: any leak makes the halves overlap and
their sum exceed the whole.

That test found a real one, and it was not in the policies. **Every view was
leaking.** A Postgres view executes as the role that *owns* it, not the role
querying it, so row-level security on the underlying tables is never applied.
The tables were all locked down correctly and all eight views handed the data
straight back out: one customer could read another's prompts, visibility, action
queue and connections, and a user belonging to no organisation at all could read
everything. `security_invoker` is off by default for backwards compatibility,
which is exactly why this is easy to ship without noticing. Migration 0007
turns it on.

`placement_targets` is a **materialized** view, and those carry no policies and
cannot carry `security_invoker` — they are stored rows with no policy support.
The tenant filter is therefore written into `v_placements`, and direct access to
the materialized view is revoked.

## Approve and deploy

Two steps, on purpose:

- **Approve** records that a person read the artifact and wants it. It deploys
  nothing.
- **Deploy** builds a plan from every approved action and opens one draft pull
  request.

Collapsing them into one click would mean a stray tap ships generated copy into
a production site — and the whole argument for a draft PR is that a human sees
the diff first.

Status transitions are guarded in the `where` clause rather than read-then-write
(`update … where status in ('draft')`), so a double-submitted form resolves to
one update and one no-op instead of two conflicting writes. Buttons show a
pending label, because the gap between click and commit is exactly when someone
clicks again.

Deploy has four outcomes, and **`planned` is a success, not a failure**: the plan
is built and shown, and nothing is pushed. That is what happens when GitHub is
not configured. Reporting a pull request URL that does not exist would be worse
than reporting nothing.

## Prompt generation

```bash
OPENAI_API_KEY=sk-... npm run prompts
```

Crawls the site for seeds, generates a set, and prints it for a person to read.
Nothing is written anywhere — the prompt set is the largest recurring cost in
the product, so it gets reviewed before it starts being measured every week.

The **Prompts** screen has the same thing as a button. It crawls, generates,
saves to Supabase, and reports what the new prompts add to every run in calls —
that last number is what the size of the set actually decides. Without
`OPENAI_API_KEY` it says so and generates nothing; on fixtures it runs the real
validation, deduplication and caps through a **template writer** so the machinery
can be reviewed offline. That writer is never a fallback for the real one: a
caller that quietly used it when a key was missing would hand a customer a set of
filled-in templates.

**Seeds come from the catalogue and from Search Console, never from the topic
alone.** A set imagined from "knives and outdoor gear" asks about products the
site does not stock, and every one of those is a paid measurement of a question
that can never be won.

### Search Console

Connect from the **Settings** screen, or set the environment variables directly
for a single-project deployment. Either way, seeds then come from measured
demand instead of inferred demand. Queries are ranked by **opportunity,
not impressions**:

| Case | Treatment | Why |
|---|---|---|
| Position past 30 | scored **zero** | Gate 2 — an engine will not retrieve a page that far down, so nothing written can win it. Measuring it weekly buys nothing. |
| Position 1–3, clicks already coming | heavily discounted | Demand the site already converts. A citation adds little. |
| Everything between | scored by impressions not converted | Visible, not winning. This is where the work pays. |

Branded queries are dropped before the model is called — they are demand the
site already owns, and the generator would reject the resulting prompts anyway.

Two details this client gets right that are easy to miss: `sc-domain:` property
names are percent-encoded (unencoded, the colon makes the API read a malformed
URL and 404), and the default window ends **three days ago**, because Search
Console data lags and asking for today returns an empty result that reads as
"this site has no queries".

Four rules the generator enforces on what comes back:

| Rejected | Why |
|---|---|
| **Names the brand** | A question naming the shop is one the shop nearly always wins. It measures brand recall, not discovery, and the number only ever goes up. Opt in with `allowBrandPrompts` if you want a few. |
| **Under 4 or over 15 words** | Below that it is a keyword; above it, nobody types it. |
| **No question signal** | A bare noun phrase is keyword research, not a prompt. |
| **Duplicate** | "best budget barlow under $40" and "cheapest barlow knife under 40 dollars" are one question. Both would be measured on every engine, three times, every week, forever. |

Intent is classified deterministically — "best", "vs" and "where to buy" are
unambiguous, and a model call would add cost and drift to a decision regex gets
right. When the total cap bites, commercial and comparison prompts are kept over
informational ones: an informational win is a citation nobody buys after.

The report ends with what the set will cost per week, because that is the number
the size of the set actually decides.

## Connecting Google

`Settings → Connect Google Search Console` runs a standard authorization-code
flow with PKCE. Four decisions in it are worth knowing, because each is a
common way this integration ships broken or unsafe:

- **`prompt=consent` is forced.** Without it Google returns a refresh token only
  on a user's *first* grant. A second connection gets an access token and no
  refresh token, everything looks fine, and the integration dies an hour later
  when that token expires. This is the single most common Google OAuth bug.
- **`state` is checked in constant time, and the callback refuses without it.**
  Otherwise the callback accepts any code anyone can make it load, which lets an
  attacker walk a signed-in admin through a consent screen for the *attacker's*
  Google account and quietly connect the project to it. The tool would then read
  the wrong Search Console and nobody would know why the data looked odd.
- **Read-only scope.** Search Console offers read-write; this product only ever
  reads. Asking for more access than a feature needs is how a breach turns from
  an information leak into someone editing a customer's property.
- **The refresh token is encrypted before storage** (AES-256-GCM, key from the
  environment). A refresh token is a permanent key to someone's Search Console:
  in plaintext, every backup, read replica and stray `select *` holds it. With
  no `SEARCHPREX_ENCRYPTION_KEY` set the connection is **refused**, not stored
  in the clear.

State and PKCE verifier live in short-lived httpOnly cookies with
`sameSite: 'lax'` — `strict` would drop them on the redirect back from Google
and reject every legitimate return as a mismatch. They are cleared on every
path, success or failure, so a used state cannot be replayed.

After connecting, the screen lists the account's properties and asks which one
to read. A domain property and a URL-prefix property for the same site hold
different data, and the wrong choice returns an empty result that reads as
"this site has no queries".

Disconnecting deletes the credential rather than marking it inactive. A refresh
token nobody intends to use is still a working key.

## Scheduled jobs

```
POST /api/jobs/measure     Authorization: Bearer $SEARCHPREX_JOB_SECRET
POST /api/jobs/remeasure
```

An HTTP endpoint rather than a binding to one job runner. Vercel Cron, pg_cron,
GitHub Actions and Inngest can all POST to it, and which one a deployment uses
is the operator's call. The parts that must not be got wrong live below that
line, where they are the same whatever triggers them:

**A lease, enforced by the database.** `job_runs` carries a partial unique index
on `(project_id, job) where status = 'running'`. Cron is not exactly-once
anywhere — a retry, two regions, or someone pressing Run beside the schedule all
produce a second call — and a duplicate full run is 900 paid API calls, not a
warning. Two processes racing is precisely the case application logic gets
wrong, so the guard is an index. A crashed worker's lease expires and the next
acquire reclaims it.

**A call budget.** `CallBudget` makes overspending impossible rather than
unlikely, and the whole repeat set is reserved before a prompt is measured — a
budget that stopped mid-prompt would record a one-attempt sample, which reads
like a verdict but is not one.

**Prompt-major ordering.** When the budget runs out the run leaves prompts fully
measured across every engine, not every prompt measured on one engine. The first
is a smaller but usable picture; the second cannot be compared against anything.

**Partial work is kept.** Each result is persisted as it lands, and everything
not reached is returned as a `skipped` row so the remainder can be scheduled
rather than silently lost.

Suggested cadence is weekly, not daily — see the cost model in the spec. Daily
quadruples the bill for a number nobody acts on daily.

## Rollback

A deployed action carries a **Roll back** control behind a two-click confirm,
for the same reason Deploy is a separate button from Approve: both write to a
production repository, and neither should be one stray tap away.

Rollback opens a **revert pull request** built from the snapshot taken before
the deploy — never a force-push or a branch delete. The original may already be
merged, and rewriting history under a team that has pulled it does more damage
than the change being undone. The deployment row is marked rolled back before
the action moves, so a failure between the two leaves a record that the revert
happened rather than an action that looks deployable again with no snapshot
behind it.

## The screens

| Screen | Route | What it is for |
|---|---|---|
| **Actions** | `/p/mso/actions` | The queue. Ranked work, each with its artifact and a reason. |
| Visibility | `/p/mso` | The scoreboard, sorted by what is fixable today rather than by volume. |
| Placements | `/p/mso/placements` | Link targets ranked by AI citation frequency, not authority. |
| Proof | `/p/mso/proof` | Before/after per deploy, against a control group. |
| Prompts | `/p/mso/prompts` | The prompt universe by cluster and intent. |

Three rules the UI holds to, because the numbers are easy to misrepresent:

- **A citation count always shows its denominator.** `1/3` is drawn as three
  pips with one filled, never as a tick. A bare "cited" from one lucky sample is
  the single most misleading thing this product could print.
- **Status is never colour alone.** Every verdict dot sits beside its word, so
  meaning survives colourblindness, greyscale print and forced-colors.
- **Certainty rides on every recommendation.** `proven`, `strong` and
  `plausible` are visually distinct, because the customer prices the work off
  that label.

## The other three surfaces

**Gemini** runs through the Generative Language API with search grounding. One
detail decides whether it works at all: `groundingChunks[].web.uri` is *not the
page's URL* — it is a link into `vertexaisearch.cloud.google.com`, and those
redirects expire. Used directly, every citation resolves to one Google domain:
the customer's own pages never match, competitor checks always fail, and the
placement graph collapses to a single entry. The whole run reads as "nobody is
ever cited". `web.title` carries the real source, usually the bare domain, and
is preferred whenever it parses as a hostname.

**AI Overviews** has no official API, so it comes through a SERP vendor — a
vendor dependency and a per-query cost, not an SLA. This is where `answered:
false` finally earns its place in the type system: **AI Overviews does not fire
on most queries.** Every other adapter can ignore that distinction because their
surfaces always answer. Here it is the common case, and collapsing it into "not
cited" manufactures gaps for prompts where no answer box existed for anyone to
be cited in.

**Copilot has no public API** and Microsoft retired the Bing Search API. What is
reachable is the AI answer box on the Bing results page, which shares retrieval
with Copilot but is not the same product. It is implemented, labelled **"Bing AI
answers"** everywhere a person sees it, and off unless `SEARCHPREX_ENABLE_BING=1`.
Reporting it as Copilot would be claiming a measurement that was never taken.

## Headless rendering

`js_only` needs a rendered word count, which needs a browser. Wire
`createPlaywrightRenderer` into `buildSiteEvidence({ renderHtml })`; without it
the gap is not reported rather than guessed at.

The renderer blocks images, fonts, media and stylesheets — only text matters and
they are most of the bytes — and waits for `domcontentloaded` plus a short
settle rather than `networkidle`, which a storefront with analytics and chat
widgets may never reach.

Two things had to change before this could work at all, both found by running it
against a real JavaScript-rendered page:

- **Candidate selection ran on raw HTML.** A JS-rendered site scores near zero
  on every page, so every prompt came back `no_page` — "you have no page about
  this" — and `js_only` could never fire. When nothing clears the floor and a
  renderer is wired, the thinnest candidates are now rendered and re-scored.
- **The scoring could only clear the floor if the title restated the question.**
  Real product titles are product names. Scoring is now per-term coverage
  weighted by prominence — title, heading, URL, body — so a page whose body
  answers the question qualifies on that alone.

`js_only` is also judged on the **ratio** now, not an absolute size. The old
floor of 800 rendered words caught only large pages and silently missed ordinary
product ones: a page whose raw HTML holds twenty words and whose rendered DOM
holds three hundred is exactly as invisible to a crawler as one holding three
thousand.

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

### Shopify

Shopify has **no pull request and no draft**, so the git target's whole safety
story — a person reads a diff before anything ships — does not exist here. A
write lands on the storefront the moment it succeeds. Two things carry the
weight instead: the plan is built and shown before it is applied, and every
change stores its previous content *before* the write, so the rollback exists
before the thing it undoes. The UI says this in as many words and the button
reads **Apply to storefront**, not *Open pull request*.

| Action | Where it goes |
|---|---|
| `answer_block` | the product's `body_html` — server-rendered by every theme, and the page's main content |
| `crawl_fix` | `templates/robots.txt.liquid` on the **published** theme |
| `schema` | **refused** — see below |
| everything else | by hand |

A metafield would need a theme edit to render at all, and a theme edit changes
every product at once: a blast radius no automated deploy should have.

**Schema is refused, not unimplemented.** Shopify themes already emit Product
JSON-LD, so adding a second block is the same duplicate-type conflict the git
target refuses — engines pick one unpredictably and the conflict would be ours.

Two Shopify-specific traps the code handles:

- **A robots.txt template that does not exist yet.** Shopify generates one when
  the store has never customised it. Writing a template containing only our
  allow group *replaces* that generated file and silently deletes every default
  rule, exposing `/cart`, `/checkout` and `/account`. A template created from
  scratch therefore emits `robots.default_groups` first, and a rollback restores
  the defaults rather than an empty file.
- **The leaky bucket.** Forty requests of headroom refilling at two a second.
  The client reads `X-Shopify-Shop-Api-Call-Limit` and slows down as it fills
  rather than waiting for a 429 — which, hit partway through a batch, leaves
  some products updated and some not.

Writes stop at the first failure. A half-applied catalogue is worse than a
partial one that says exactly where it stopped.

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

## The re-measure job

```ts
const outcomes = await runRemeasure(pendingRows, { adapters, context, fetchPage });
const records = outcomes.flatMap((o) => (o.kind === 'measured' ? [o.record] : []));
const lift = cohortLift(records);
const rates = winRates(records);        // feeds back into priorityFor()
```

Fourteen days after a deploy, the same prompts run against the same engines and
the result is compared to the baseline. Three guards run first, and each exists
because skipping it writes a wrong number into the evidence base that trains the
ranker:

| Guard | Without it |
|---|---|
| **Due?** | Credits or blames a change the index has not seen yet |
| **Live?** | Records a loss for a draft PR nobody merged |
| **Answered?** | Records a loss for an engine outage |

None of the three produce a record. They reschedule — the only honest thing to
do with a measurement that did not happen. The live check works because every
deployed block carries its `searchprex:block` marker, so the crawler can see
whether the change actually shipped.

### Nothing here is significant on its own

With three attempts a side, **no single prompt comparison is statistically
significant.** A move from 0/3 to 2/3 has a Fisher exact p of roughly 0.4 —
indistinguishable from the engine answering differently on the day. Even 0/3 to
3/3 only reaches about 0.1.

So `confident` is set only for a complete flip, where the raw numbers are at
least unambiguous about direction, and everything else is directional evidence
that belongs in an aggregate. Any tool showing you a per-prompt "we won this
one" from three samples is showing you noise.

### Control prompts are what make the number mean anything

Between a baseline and a follow-up two weeks later the engines retrain and
reindex, competitors publish, and the site changes for unrelated reasons. A raw
before/after cannot separate our work from any of that.

Prompts with no action deployed are marked `isControl` and ride the same drift.
`cohortLift` reports `treatedDelta - controlDelta`, and sets `hasControl: false`
when there is no control group — in which case the UI must say "changed", never
"we caused".

### Win rates gate themselves

`winRates` returns nothing for an action type with fewer than 20 records, and
the ranker reads a missing rate as 0.5. Three lucky deploys reporting 1.0 would
otherwise push that action type to the top of every customer's queue on evidence
indistinguishable from chance.

## Not built yet

Prompt generation, the Shopify / WordPress / Webflow deploy targets, and the
Gemini / AI Overviews / Copilot adapters.

The re-measure job is a pure function over pending rows — scheduling it (cron,
Inngest, pg_cron) and persisting `LiftRecord`s is the app's job, not this
package's. Adding an engine means
implementing `EngineAdapter` — nothing downstream of `analyseResult` is
engine-specific.

`js_only` detection needs a rendered word count, which means a headless
browser. `buildSiteEvidence` takes an optional `renderer` hook for that; without
one wired, `js_only` is simply not reported rather than guessed at.
