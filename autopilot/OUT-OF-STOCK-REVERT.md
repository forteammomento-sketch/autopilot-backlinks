# Reverting the out-of-stock publish gate

**Question:** the autopilot was told to skip out-of-stock products. The client
wants them published after all. If the gate is switched off, do the products
already skipped come back, or does it only apply from here on?

**Answer: nothing was lost. Every product the gate parked comes back on both
engines** — immediately on Searchprex, and over a seven-day window on NicheSEO
Pro unless it is nudged. No backfill, no reconstruction.

The two engines are **not** configured the same way, and the difference matters
for how the change is actually made.

| | Searchprex | NicheSEO Pro |
|---|---|---|
| Gate setting lives in | `GATE_REQUIRE_IN_STOCK` env var | SQLite `mso_settings` table, key `gate_require_in_stock` |
| Queue | Neon `IndexingQueue` | **Local** SQLite `mso_products_queue` |
| Parked products return | Every run (~5 min), unconditionally | `requeueGatedProducts(afterDays = 7)` — only those parked over 7 days ago |
| How to switch it | Set the env var, redeploy | `npx tsx scripts/set-gate-in-stock.ts off` |

> The two queues are separate stores. `MSO-AUTOPILOT-SETUP.md` says both engines
> work "ek hi product queue" — that is true of the **daily cap**, which is
> counted from the shared Neon `AutopilotPage` table, but not of the queues
> themselves. NicheSEO Pro reads Neon into its own SQLite table through
> `syncFromNeon()`, and that only runs when someone runs
> `scripts/sync-mso-neon.ts` by hand. **Switching one engine does not switch the
> other, and Searchprex's requeue does not release NicheSEO Pro's parked
> products.**

---

## 1. Why nothing was lost

Both engines park rather than retire, and both bring parked products back.

**Searchprex** (`lib/autopilot/pipeline.ts`) sets `status: 'skipped_gate'`, and
every run puts every parked product back before it picks its batch:

```ts
//  Products parked by the gate on an earlier run get another look before this
//  one picks its batch — most rejections are "out of stock", and stock comes
//  back. Without this the first gated run would retire a third of the
//  catalogue for good.
const requeued = await db.indexingQueue.updateMany({
  where: { clientId, status: 'skipped_gate', url: { contains: '/product/' } },
  data: { status: 'queued' },
})
```

That runs every five minutes today: products come back, fail the gate again, and
are re-parked. Once the stock requirement is off they pass instead. They are
also drained **ahead of** newer products — the queue is ordered
`priority asc, createdAt asc` and requeueing does not touch `createdAt`, so a
parked row keeps its original position.

**NicheSEO Pro** (`server/mso-worker.ts`) does the same thing on a timer:

```ts
export function requeueGatedProducts(afterDays = 7): number {
  const cutoff = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000).toISOString();
  ...
  WHERE status = 'skipped_gate' AND updated_at < ?
```

So its backlog returns over seven days rather than at once. `set-gate-in-stock.ts`
releases it immediately instead.

---

## 2. Making the change — both engines

### Searchprex

```
GATE_REQUIRE_IN_STOCK=false
```

Vercel → Settings → Environment Variables, then redeploy. Only `true` and `1`
read as on, so `False`, `FALSE` or a stray space all silently mean *off*.

### NicheSEO Pro

The env var does **nothing** here — `getGateConfig()` reads `mso_settings`, not
`process.env`. Run:

```bash
npx tsx scripts/set-gate-in-stock.ts off
```

That flips `gate_require_in_stock` and releases the parked backlog in one step.
`... on` puts it back.

### Leave the other gates alone

`GATE_REQUIRE_IMAGE`, `GATE_REQUIRE_PRICE`, `GATE_REQUIRE_ATTRIBUTES` (and their
`gate_require_*` equivalents) stay on. The client asked for out-of-stock
products, not for products with no photograph or no price — and those are the
pages that damage the indexed ratio most.

---

## 3. The code changes

Two patches, one per repo, both verified with `git apply --check`.

| Patch | Repo |
|---|---|
| `autopilot/searchprex-out-of-stock.patch` | `Mubasharshahzad26/searchprex-website` |
| `autopilot/nicheseo-out-of-stock.patch` | `Mubasharshahzad26/nicheseo-pro-ai` |

**Both stop out-of-stock pages being submitted to the Google Indexing API.**
Every published page currently goes straight to it — `submitUrl(...)` on
Searchprex, `submitMsoUrl(...)` on NicheSEO Pro. An out-of-stock page now skips
that submit: Searchprex's queue row lands on the existing
`published_not_submitted` status, NicheSEO Pro records
`indexing_status = 'not_submitted_out_of_stock'`. The page stays live, crawlable,
internally linked and buyable the moment stock returns — Google is simply not
asked to index it.

Override with `INDEX_OUT_OF_STOCK=true` (Searchprex) or
`index_out_of_stock = 'true'` in `mso_settings` (NicheSEO Pro).

This is the Q4 game plan's own rule, applied automatically:

> Do not blanket-noindex the tail — it still converts on long-tail. Just stop
> *asking* Google to index it.
>
> — `strategy/mso-q4-2026-seo-gameplan.md`

It matters because the gate was built for exactly the problem still being
solved. Both engines carry the same comment:

> The autopilot used to publish whatever the queue handed it. On this catalogue
> that meant 24% of recently published products had no photograph at all and 31%
> could not be bought, and Google has answered: 27,510 pages crawled and then
> declined, against 13,200 indexed.

The client gets the pages. The indexed ratio does not pay for them.

The Searchprex patch also documents every `GATE_*` flag in `.env.example` —
they were listed nowhere, which is why the switch was invisible. The NicheSEO
Pro patch adds two scripts: `set-gate-in-stock.ts`, which flips the setting and
releases the parked backlog in one step, and `mso-status.ts`, a genuinely
read-only health check (see the warning in section 4).

---

## 4. Verifying it worked

**Searchprex** answers over HTTP:

```bash
curl "https://www.searchprex.com/api/mso/status?key=$CRON_SECRET"
```

**NicheSEO Pro** runs on a workstation against a local SQLite file, so it has
to be asked there:

```bash
npx tsx scripts/mso-status.ts
```

> **Do not use `scripts/check-queue-status.ts` for this.** Despite the name it
> is not a read-only check — before printing anything it runs
> `setMsoSetting('circuit_breaker_alert', '')`,
> `setMsoSetting('scheduler_enabled', 'true')` and
> `setMsoSetting('daily_limit', '500')`. Running it to "just look" silently
> halves the cap the two engines share and erases the record of why the breaker
> tripped. `scripts/set-daily-limit.ts` and `scripts/run-mso-daemon.ts` write
> the same 500. `mso-status.ts` only reads.

After the next run of each engine:

- `quota.publishedToday` keeps climbing — out-of-stock products are passing
- run logs no longer show `stock_outofstock=` in the gate tally
- Searchprex run stats carry a `notSubmitted` count; NicheSEO Pro logs
  `Published … without an indexing submit — out of stock`
- queue rows read `published_not_submitted` / `not_submitted_out_of_stock`,
  not `submitted`

Spot-check one known out-of-stock product: the page should be live and its
`Product` schema should say `OutOfStock`. That already worked —
`bladehq-layout.ts` (present in both repos) has always set availability from
`stock_status`, so the schema stays honest.

## 5. Rolling back

Searchprex: `GATE_REQUIRE_IN_STOCK=true`, or delete the variable — the default
is `true`. NicheSEO Pro: `npx tsx scripts/set-gate-in-stock.ts on`. Products
parked afterwards are recoverable the same way, for the same reason.
