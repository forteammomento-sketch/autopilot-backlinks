# @searchprex/core

Engine adapters and citation analysis for the **AI Visibility Autopilot** feature.
Spec: [`../strategy/searchprex-ai-visibility-autopilot.md`](../strategy/searchprex-ai-visibility-autopilot.md).

V0 so far: two engine adapters, citation analysis, and the gap detector that
turns an uncited prompt into a typed, evidenced finding. Framework-free — no
Next.js imports — so it drops into `lib/` of the app unchanged.

## Install

```bash
npm install
npm test          # 93 unit tests, no network
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
src/gaps/detect.ts          gap detection across the four gates
supabase/migrations/        V0 schema with RLS
```

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

Gap detection consumes a `SiteEvidence` the caller supplies; the crawler that
fetches robots.txt, the candidate page and its rendered word count is not in
this package yet.
