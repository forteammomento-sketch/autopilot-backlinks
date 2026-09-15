# Reverting the out-of-stock publish gate

**Question:** the autopilot was told to skip out-of-stock products. The client
wants them published after all. If the gate is switched off, do the products
already skipped come back, or does it only apply from here on?

**Answer: they come back on their own, and they come back first.** No backfill,
no SQL, no manual reset.

---

## 1. Why nothing was lost

A product that fails the gate is **parked**, not retired
(`lib/autopilot/pipeline.ts`):

```ts
await db.indexingQueue.update({
  where: { id: queued.id },
  data: { status: 'skipped_gate' },
});
```

And every run puts every parked product back in the queue **before** it picks
its batch:

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

That requeue is already running every five minutes. Today the products come
back, fail the gate again and are re-parked. The moment the stock requirement
is off, they pass instead.

They are also picked up **ahead of** newer products: the queue is ordered
`priority asc, createdAt asc`, and requeueing does not touch `createdAt`, so a
parked row keeps its original position. Expect the first days after the change
to drain the backlog before the queue returns to normal.

---

## 2. Making the change

The gate is environment-driven, so this needs no code deploy on its own.

| Variable | Set to | Where |
|---|---|---|
| `GATE_REQUIRE_IN_STOCK` | `false` | Searchprex (Vercel env) **and** NicheSEO Pro |

Leave `GATE_REQUIRE_IMAGE`, `GATE_REQUIRE_PRICE` and `GATE_REQUIRE_ATTRIBUTES`
at `true`. The client asked for out-of-stock products, not for products with no
photograph or no price — and those are the pages that damage the indexed ratio
most.

Two things to watch:

- **Only `true` and `1` count as on.** `False`, `FALSE`, `no`, or a stray space
  all read as *off*. Set the value exactly and re-check it after saving.
- **Both engines must move together.** Searchprex and NicheSEO Pro work the same
  catalogue from opposite ends of the same queue, and NicheSEO Pro runs the same
  rules in `server/mso-quality-gate.ts`. Change one only, and one engine
  publishes what the other keeps parking.

---

## 3. The accompanying code change

`autopilot/searchprex-out-of-stock.patch` applies to the
`Mubasharshahzad26/searchprex-website` repo:

```bash
git apply autopilot/searchprex-out-of-stock.patch
```

It does two things.

**Documents the gate in `.env.example`.** None of the `GATE_*` flags were listed
anywhere, which is why the switch was invisible.

**Publishes out-of-stock pages without asking Google to index them.** Every
published page currently goes straight to the Indexing API:

```ts
const submission = await submitUrl(published.liveUrl, 'new');
```

An out-of-stock page now skips that submit and its queue row lands on the
existing `published_not_submitted` status. The page is live, crawlable, linked
and buyable the moment stock returns — Google is simply not asked to index it.

This is the Q4 game plan's own rule, applied automatically:

> Do not blanket-noindex the tail — it still converts on long-tail. Just stop
> *asking* Google to index it.
>
> — `strategy/mso-q4-2026-seo-gameplan.md`

It matters because the gate was added for exactly the problem still being
solved. From `lib/autopilot/quality-gate.ts`:

> The autopilot used to publish whatever the queue handed it. On this catalogue
> that meant 24% of recently published products had no photograph at all and 31%
> could not be bought, and Google has answered: 27,510 pages crawled and then
> declined, against 13,200 indexed.

The client gets the pages. The indexed ratio does not pay for them.

Override with `INDEX_OUT_OF_STOCK=true` if the indexed ratio recovers and the
pages should be submitted after all.

---

## 4. Verifying it worked

```bash
curl "https://www.searchprex.com/api/mso/status?key=$CRON_SECRET"
```

After the next run:

- `quota.publishedToday` keeps climbing — out-of-stock products are now passing
- run logs no longer show `stock_outofstock=` in the gate tally
- run stats carry a `notSubmitted` count: pages published without an indexing
  submit
- queue rows for those products read `published_not_submitted`, not `submitted`

Spot-check one known out-of-stock product: its page should be live, and its
`Product` schema should say `OutOfStock`. That part already worked —
`lib/autopilot/bladehq-layout.ts` has always set availability from
`stock_status`, so the schema stays honest.

## 5. Rolling back

Set `GATE_REQUIRE_IN_STOCK=true` on both engines, or delete the variable — the
default is `true`. Products parked afterwards are recoverable the same way, for
the same reason.
