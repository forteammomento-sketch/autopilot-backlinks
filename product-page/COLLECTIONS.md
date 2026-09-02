# Collections for the product page

The product page template has exactly two taxonomy hooks:

```
/collections/{{CATEGORY_SLUG}}/     ← breadcrumb parent, one per product
/brand/{{BRAND_SLUG}}/              ← brand hub
```

Everything else on the page — steel, blade length, lock, handle, opening,
origin — is a **spec field**, and every spec field can become a collection.
That is the opportunity and the trap, so read the next section before you
build anything.

`collections.csv` is the full list: 52 entries, 40 indexable, 12 filter-only.

---

## Read this first

**One primary category per product. No exceptions.**

The breadcrumb needs a single parent. If a knife sits in both Hunting Knives
and Fixed Blade Knives as a primary, you get two breadcrumb trails to the
same product and two paths for Google to crawl. That is how a catalogue turns
into 40,000 URLs. Pick one primary; everything else is a facet.

**Do not make every facet indexable.**

Five spec fields × their values is roughly 35 collections. Combine two fields
and it is hundreds. This is precisely the mechanism that produced 28,000
crawled-not-indexed URLs, and building it again on purpose would undo the
sitemap work.

The CSV marks **12 collections `indexable = NO`**. Those still exist as
working filters a shopper can click; they just carry `noindex, follow` and
canonical to their parent category, and never enter the XML sitemap.

Rule of thumb: a facet earns indexation when people actually search that
phrase. *"knives under $50"* and *"D2 steel knives"* get searched.
*"micarta handle knives"* does not.

---

## 1. Primary categories — 12

One per product. These are the breadcrumb parents.

**Knives (8)** — Hunting · EDC Folding · Fixed Blade · Automatic ·
Fillet & Bait · Camping & Survival · Multi-Tools · Sharpeners & Knife Care

**Non-knife (4)** — Optics · Flashlights & Headlamps · Fishing Tackle · Apparel

> `automatic-knives` is a real category, but it is deliberately never linked
> from the California, New York or Illinois state pages. Keep it that way.

## 2. Brand hubs — 15

`/brand/{slug}/`. From the game plan, this is where the money is: brand
queries are lower competition than "best knife" round-ups, and Blade HQ's
grip is weakest on emerging makers.

**Build these seven first** — Vosteed, Kansept, Kubey, Bestech, Kunwu,
Vixino, Begg. Thin SERP coverage, and you stock them deeply.

**Then** — RUIKE, CJRB, QSP, CIVIVI, Rough Rider, Elk Ridge.

**Last, if at all** — ESEE, Cold Steel. Blade HQ and KnifeCenter own those
terms and a hub will not shift them.

Each hub needs 300–500 words of genuine context — founder, designer lineage,
steel philosophy, price band — plus the model grid and a comparison to the
nearest brand. A hub that is just a product grid ranks for nothing.

## 3. Steel hubs — 6

`/collections/knife-steel/{steel}/`. Badly underserved and the spec table on
every product page feeds them automatically.

**D2 · 14C28N · S35VN · 154CM** first — the four named in the game plan.
Then 8Cr13MoV and Damascus.

Each needs real copy: what the steel is good at, what it asks for in return,
edge retention against sharpening effort. The product page description block
already asks for two or three sentences on exactly this — write it once per
steel and reuse it.

## 4. Facets worth indexing — 7

| Slug | Why it earns a page |
|---|---|
| `knives-under-25` `knives-under-50` `knives-under-100` | Real, sustained search volume |
| `edc-knives-under-3-inch` | Linked from state pages for Detroit and Lansing carry |
| `edc-knives-under-5-5-inch` | Texas tile — clears the location-restricted category |
| `made-in-usa-knives` | Real search volume, and a genuine trust signal |
| `crossbar-lock-knives` | Trending mechanism, low competition right now |

## 5. Filter-only — 12, all noindex

Blade length bands · framelock · linerlock · slipjoint · G-10 · micarta ·
titanium · wood · drop point · tanto · assisted opening.

Useful to a shopper narrowing down. Worthless as landing pages. Ship them as
filters with `noindex, follow`, canonical to the parent category, and keep
them out of the sitemap.

---

## What this needs from the product data

Same five attributes as the state collections, plus three the spec table
already asks for:

| Attribute | Drives |
|---|---|
| `opening` | Automatic Knives, assisted facet, state-legal sets |
| `blade_type` | EDC Folding, Fixed Blade |
| `blade_length` | Length facets, Georgia and Texas sets |
| `edge_count` | Michigan set |
| `blade_shape` | Shape facets, Michigan set |
| `steel` | Six steel hubs |
| `lock` | Lock facets |
| `origin` | Made in USA |

Populate them once and the whole taxonomy builds itself. Leave them empty and
none of section 3, 4 or 5 can exist.

---

## Build order

**Week 1** — 12 primary categories, one assigned per product. Nothing else
works until every product has exactly one breadcrumb parent.

**Week 2** — the seven priority brand hubs, with real copy.

**Week 3** — four steel hubs and the three price facets. These are the
highest-volume additions in the list.

**Week 4** — remaining brand hubs, remaining steel hubs, `made-in-usa-knives`.

**Whenever** — the 12 filter-only collections. They need no copy and no
sitemap entry, so they can go in the moment the attributes exist.

---

## Before you publish any of it

- [ ] Every product has exactly **one** primary category
- [ ] Breadcrumb on the product page matches that primary category
- [ ] The 12 filter-only collections are `noindex, follow`, canonical to parent
- [ ] None of the 12 appear in the XML sitemap
- [ ] Brand hubs have copy, not just a grid
- [ ] Steel hubs have copy, not just a grid
- [ ] Sitemap total is still in the low thousands, not the tens of thousands

That last line is the one to keep checking. The whole point of this taxonomy
is a small, high-quality index — adding collections without watching the
sitemap total is how the original problem happened.
