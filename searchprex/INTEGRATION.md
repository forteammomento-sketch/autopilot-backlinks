# Dropping this into an existing SaaS

This is the AI Visibility Autopilot feature: the loop that finds why AI answers
do not cite a site, generates the fix, ships it, and measures whether it worked.

It was built as a standalone Next.js app so it could be run and reviewed, but
the parts that matter are framework-free. This file is about moving it into a
product that already exists.

---

## 1. The one thing you must change

**The code assumes one project per deployment.** `SEARCHPREX_PROJECT_ID` is read
from the environment in three places:

- `lib/data/index.ts` — which project the dashboard reads
- `lib/jobs/run.ts` — which project a scheduled job measures
- `app/api/oauth/google/callback/route.ts` — which project a connection is saved to

Your SaaS is multi-tenant, so that has to come from the signed-in session
instead. Replace `projectId()` in `lib/data/index.ts` with your own lookup and
thread it through; the data and mutation sources already take `projectId` as a
constructor argument, so nothing below that line changes.

**Do this before anything else.** Every query in `lib/data/supabase.ts` filters
by `project_id` explicitly because it runs with the service-role key, which
bypasses row-level security. If the project id comes from the wrong place, that
filter points at the wrong tenant and the RLS underneath will not save you.

---

## 2. What is framework-free and what is not

`src/` has no Next.js, no React and no Supabase import anywhere. It is plain
TypeScript with an injectable `fetch`, and it is where the actual product logic
lives. Copy it as a package or a folder; it will run under any framework, in a
worker, or from a CLI.

| Layer | Path | Coupled to |
|---|---|---|
| Engine adapters | `src/engines/` | nothing |
| Crawler | `src/crawl/` | nothing |
| Gap detection | `src/gaps/` | nothing |
| Action generation | `src/actions/` | nothing |
| Deploy targets | `src/deploy/` | nothing |
| Lift measurement | `src/measure/` | nothing |
| Prompt generation | `src/prompts/` | nothing |
| Search Console | `src/gsc/`, `src/oauth/` | nothing |
| Job runner | `src/jobs/` | nothing |
| Data access | `lib/data/` | Supabase |
| Screens | `app/` | Next.js App Router |

Every screen reads through the `DataSource` interface in `lib/data/types.ts`.
If your product is not on Supabase, implement that interface against whatever
you use and no component changes.

---

## 3. Database

Apply `supabase/migrations/` in filename order. They are plain Postgres apart
from three Supabase assumptions: the `auth.users` table, `auth.uid()`, and the
`pgcrypto` extension.

Two of these migrations exist because running them turned up real bugs — read
`0006` and `0007` before you decide to squash them into `0001`.

**`0007` is the one to understand.** A Postgres view runs as the role that
*owns* it, so RLS on the underlying tables is not applied. Every view here was
handing one tenant's data to another until `security_invoker` was turned on. If
you write new views, they need it too.

`npm test` applies all of this to a real Postgres (PGlite, in WebAssembly) and
tests tenant isolation as a non-superuser. Keep those two test files —
`src/__tests__/migrations.test.ts` and `src/__tests__/rls.test.ts` — and point
them at your schema. A superuser bypasses RLS entirely, so a test that queries
as one passes against a database with no policies at all.

---

## 4. Environment

See `.env.example`. Nothing is required to start: with no configuration the app
runs on fixtures so you can see every screen working. Each integration is
independently optional and says so in the UI when it is missing, rather than
failing quietly.

The one hard requirement is **`SEARCHPREX_ENCRYPTION_KEY`** before anyone
connects Google. Without it the OAuth callback refuses to store the refresh
token rather than writing it in plaintext.

---

## 5. What is proven and what is not

Everything is tested against a stubbed `fetch` — 351 tests. Two things were
verified for real, and are worth knowing apart from the rest:

- **The migrations and RLS** run against real Postgres in the test suite.
- **Headless rendering** was verified end to end against a live
  JavaScript-rendered page.

**No live API call has ever been made** from this codebase: not Perplexity,
OpenAI, Gemini, a SERP vendor, Shopify, Google OAuth or Search Console. The
request shapes follow each provider's documentation and the parsing is tested
against recorded response shapes, but the first real call will be yours. Start
each integration with one prompt, one product, one property.

`npm run smoke` and `npm run crawl` exist for exactly that.

---

## 6. Where the judgement is

Most of this is ordinary code. A handful of decisions are the product, and they
are the parts to keep if you change everything else:

- **Three samples per prompt, and `contested` as a real verdict.** These models
  answer the same prompt differently each time. One call is a sample of size
  one.
- **Refusal is an output.** With no first-party facts, a generated block can
  only restate the competitor page already being cited.
- **`rank_first`.** A page at position 40 cannot be retrieved, so no content is
  generated for it.
- **Control prompts.** Without them a before/after cannot separate your work
  from the engines reindexing.
- **`unknown` is not `absent`.** An outage is not evidence.

`README.md` explains each of these where it lives.
