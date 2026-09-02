# @searchprex/core

Engine adapters and citation analysis for the **AI Visibility Autopilot** feature.
Spec: [`../strategy/searchprex-ai-visibility-autopilot.md`](../strategy/searchprex-ai-visibility-autopilot.md).

This is V0 slice 1: the Perplexity Sonar adapter plus everything needed to turn
one engine answer into a row the Action Engine can act on. Framework-free — no
Next.js imports — so it drops into `lib/` of the app unchanged.

## Install

```bash
npm install
npm test          # 41 unit tests, no network
npm run typecheck
```

## Live check

Unit tests stub `fetch`, which proves the parsing but not that Perplexity
accepts our request body. After any change to the request shape:

```bash
PERPLEXITY_API_KEY=pplx-... npm run smoke "best budget barlow pocket knife under $40"
```

Spends 3 API calls and prints the citation breakdown per attempt.

## What's here

```
src/engines/types.ts        EngineAdapter contract — one call per query()
src/engines/errors.ts       EngineError + retryable/non-retryable split, backoff
src/engines/perplexity.ts   Sonar adapter
src/lib/domain.ts           eTLD+1 normalisation for citation matching
src/lib/brand.ts            brand mention detection in answer text
src/lib/citations.ts        self / competitor / third_party classification
src/runner/sample.ts        3x repeat + retry, verdict aggregation
supabase/migrations/        V0 schema with RLS
```

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

Prompt generation, gap detection, the Action Engine, deploys, and the OpenAI /
Gemini / AI Overviews adapters. Adding an engine means implementing
`EngineAdapter` — nothing downstream of `analyseResult` is Perplexity-specific.
