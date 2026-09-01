# Knife Laws by State — Elementor build kit

Production code for the state-level programmatic asset in the
[Q4 game plan](../strategy/mso-q4-2026-seo-gameplan.md). Replaces the
"location pages" idea, which would have deepened the crawled-not-indexed problem.

| File | What it is | Where it goes |
|---|---|---|
| `knife-law-pages.css` | Scoped stylesheet | **Once**, in Site Settings → Custom CSS |
| `michigan.html` | Working example — researched, cited, homepage-styled | Elementor HTML widget on `/knife-laws/michigan/` |
| `_TEMPLATE.html` | Blank template with `{{TOKENS}}`, plus keyword map and fill checklist | Duplicate per state |
| `ELEMENTOR-SETUP.md` | Step-by-step build guide (Roman Urdu) | Read before your first page |
| `state-data.csv` | The 12 fields to research per state | Your research tracker |
| `wireframe/` | Approved block structure and CRO reasoning | Reference |

## Page structure

The page follows the home page's own section rhythm, not a document layout:

`hero banner → trust bar → product grid with promo tile → quick-answer table
→ six short answer cards → category grid → brand strip → seasonal promo →
reviews → featured knives with tabs → email capture → sources → sibling states`

The legal content is deliberately compact — a six-row table plus six
two-sentence cards. It is what earns the ranking for "{state} knife laws"
(a pure product page ranks for nothing here), but it reads at the pace of
the rest of the site.

---

## Install (once)

1. **Elementor → Site Settings → Custom CSS** — paste all of `knife-law-pages.css`.
   *(Custom CSS is Elementor Pro. On free Elementor, put it in your child theme's
   `style.css`, or in Appearance → Customize → Additional CSS.)*
2. Save. You never touch the CSS again — all 51 pages update from this one place.

**Do not paste the CSS into each page.** Fifty-one copies of the same stylesheet is
~9 KB of duplicate render-blocking CSS per page and makes every future restyle a
51-page job.

## Per state page

1. Pages → Add New → title it `Michigan Knife Laws` → permalink `knife-laws/michigan`
2. Edit with Elementor → drag in a single **HTML widget** (full-width container,
   no extra padding — the CSS handles its own max-width and spacing)
3. Paste the state's HTML, including the `<script type="application/ld+json">` block
   at the bottom. Elementor passes it through untouched.
4. **Check for a duplicate H1.** If your Elementor template already prints the page
   title as an `<h1>`, either hide the title in the template or change the widget's
   `<h1>` to `<h2>`. Two H1s on the page is a real, avoidable defect.
5. In Yoast / Rank Math set the SEO title and meta description by hand — lead with the
   verdict, not the state name:
   `Michigan Knife Laws 2026: Switchblades Legal, Concealed Daggers Are a Felony`
6. Add the URL to your XML sitemap. **These are pages you genuinely want indexed** —
   unlike the 28K SKUs.

## Build the hub before the spokes

Create `/knife-laws/` first with all 51 links and a comparison table. Each state page
links back up to it, and the hub links down to every state. That reciprocal structure
is what makes 51 pages behave as one authoritative asset instead of 51 orphans —
the same hub-and-spoke discipline that applies to your brand hubs.

---

## The 12 fields to research per state

Fill these before writing any HTML. `state-data.csv` is set up for exactly this.

| # | Field | Notes |
|---|---|---|
| 1 | Automatic / switchblade | Legal to own? To carry? Cite the statute or the repealing act |
| 2 | Balisong / butterfly | Often classified separately from autos |
| 3 | Gravity / OTF | Several states still treat these as a distinct category |
| 4 | Statewide blade-length limit | Usually **none** — say so plainly, it is the most-searched question |
| 5 | Open carry | Ordinary folder, ordinary adult |
| 6 | Concealed carry | The category that actually creates felonies |
| 7 | Vehicle possession | Frequently a separate offence from carry |
| 8 | Preemption | Yes / no. If no, name the cities with their own limits |
| 9 | Named city ordinances | The 2–3 biggest cities with stricter rules |
| 10 | Schools / government buildings | Near-universally prohibited; cite it anyway |
| 11 | Minors | Purchase and possession age limits |
| 12 | The local myth | The thing forum posts get wrong. **This is what earns links.** |

### Sourcing rules — non-negotiable

- **Primary source or nothing.** Every citation links to the state legislature's own
  site. AKTI is an acceptable secondary source; a competitor's blog is not.
- **Never publish a statute number you have not opened and read.** An invented citation
  on a legal page destroys the exact trust the page exists to build, and it is the one
  error that a reviewer, a journalist, or a competitor will find and publicise.
- **Do not let the autopilot content pipeline generate these.** Use AI to draft the
  plain-English explanation *after* you have the verified facts in the CSV — never to
  supply the facts.
- Delete any rule card you cannot cite. A page with four sourced rules outranks a page
  with nine unsourced ones, and carries none of the risk.

---

## Matching the site theme

The stylesheet opens with a **theme block** — ten variables read off your homepage.
That is the only part you should need to touch:

```css
--kl-accent:#EDA53B;      /* amber CTA — search button, Browse Categories */
--kl-accent-dk:#D18F2A;   /* amber hover */
--kl-accent-ink:#1B2B39;  /* text ON amber — dark, as your buttons use */
--kl-header:#20303F;      /* dark slate header bar */
--kl-heading:#1B2B39;     /* near-black navy — section titles */
--kl-price:#5E9F32;       /* green sale price */
--kl-body:#5A6673;        /* body grey */
--kl-border:#E3E6E9;      /* card / divider grey */
```

These were read off screenshots, so they are close but not exact. To correct them in
two minutes: right-click the amber **Search** button on your homepage → Inspect → copy
the computed `background-color` → paste it into `--kl-accent`. Repeat for the header
bar and a green sale price. Nothing else hardcodes a colour.

**Typography needs no configuration.** Everything uses `font-family: inherit`, so the
pages pick up your theme font automatically. There is no font to match and no way for
it to drift if you change themes later.

### Site patterns reused

| Homepage pattern | Where it appears on the state page |
|---|---|
| Product card — micro-label, name, struck price + green price | Blocks 03 and 08 |
| Category tile — image, name, product count | Block 06 |
| Five-icon trust bar | Above the sources block |
| Centred section title + amber subline | Every section heading |
| Amber button, dark text | All CTAs |
| Dark slate header band | Hero and email capture |

**Verdict pills** — three semantic states, used in the glance table and rule cards:

```html
<span class="mso-kl__pill mso-kl__pill--ok">Legal</span>       <!-- green -->
<span class="mso-kl__pill mso-kl__pill--warn">Check city</span> <!-- amber -->
<span class="mso-kl__pill mso-kl__pill--no">Felony</span>       <!-- red   -->
```

**Compliance chip** on product cards — the device that makes a product grid read as a
continuation of the legal answer rather than an ad break:

```html
<span class="mso-kl__legal-chip">MI-Legal</span>
<span class="mso-kl__legal-chip mso-kl__legal-chip--warn">Under 3&Prime;</span>
```

Only apply it to knives you have actually confirmed against the state's restriction.
It is a legal-adjacent claim and needs the same care as the statute text.

## Recommended build split

You do not need to put all 13 blocks in one HTML widget:

| Widget | Blocks |
|---|---|
| HTML widget A | 01–07 — hero through restricted places |
| **Elementor Products widget** | 08 — set to *Top Rated*, 4 columns |
| HTML widget B | 09–13 — seasonal through sibling states |

The CSS styles both. Using the native Products widget for block 08 means it keeps
itself current instead of you hand-editing 51 pages.

## Blocks that stay hidden at launch

- **Block 08** ships labelled **"Staff Picks"**. Relabel to *"Best Rated by Our
  Customers"* only once the review app has genuine counts. **Never** label it
  "top sellers in {State}" until state-level order volume truthfully supports it.
- **Block 10** (photo review wall) is omitted from the template entirely until the
  review back-fill campaign has run. An empty block is worse than no block.

## Prerequisite before block 03 can ship

Blade-length and edge-count attributes on every SKU. Without them you cannot build
`/collections/{state}-legal-carry-knives/` or apply the compliance chip honestly.
This is on the critical path.

## Rollout order

Ship 10 states first, measure for 30 days, then finish the 50.

`MI · TX · FL · PA · OH · NY · GA · NC · TN · CA`

Michigan first because it is your home state and your strongest E-E-A-T claim. Texas
and Florida next on hunting population. **Do not build city-level pages** — the demand
is not there, and it recreates the thin-page problem this asset exists to avoid.

## Scaling past 10 pages

Fifty-one HTML widgets is workable but manual. When you commit to the full 50, move to
a custom post type (`knife_law`) with ACF fields matching the 12 columns above, plus one
Elementor Theme Builder single template that renders them. Same markup, same CSS,
one template to maintain, and a schema block that populates itself. Do that migration
*after* the first 10 prove the traffic, not before.

## Measuring it

Track separately from the rest of the site — this asset has a different job:

- Impressions and clicks on `/knife-laws/*` (Search Console, filter by URL path)
- Click-through from a state page into its `/collections/{state}-legal-carry-knives/`
- Referring domains earned by the state pages — the PR angle from the game plan
- Assisted conversions, not last-click. These pages open the session; they rarely close it.
