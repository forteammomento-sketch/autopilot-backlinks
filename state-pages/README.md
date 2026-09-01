# Knife Laws by State — Elementor build kit

Production code for the state-level programmatic asset in the
[Q4 game plan](../strategy/mso-q4-2026-seo-gameplan.md). Replaces the
"location pages" idea, which would have deepened the crawled-not-indexed problem.

| File | What it is | Where it goes |
|---|---|---|
| `knife-law-pages.css` | Scoped stylesheet | **Once**, in Site Settings → Custom CSS |
| `michigan.html` | Fully researched, fully cited example | Elementor HTML widget on `/knife-laws/michigan/` |
| `_TEMPLATE.html` | Blank template with `{{TOKENS}}` | Duplicate per state |
| `state-data.csv` | The 12 fields to research per state | Your research tracker |

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

## Design notes

**Verdict pills** — three semantic states, used in both the table and the rule cards:

```html
<span class="mso-kl__pill mso-kl__pill--ok">Legal</span>      <!-- green  -->
<span class="mso-kl__pill mso-kl__pill--warn">Check city</span><!-- amber  -->
<span class="mso-kl__pill mso-kl__pill--no">Felony</span>      <!-- red    -->
```

**Rebranding** — change the four tokens at the top of the CSS and the whole system
follows. Nothing else hardcodes a colour:

```css
--kl-accent:#B93B0C;   --kl-accent-soft:#F6E6DE;
--kl-pine:#24463A;     --kl-pine-soft:#E1EAE4;
```

**Typography** inherits from your Elementor theme (`font-family:inherit`), so the
pages will look native to the site rather than bolted on. Only the citation chips and
labels use a monospace stack, deliberately — they read as data, not prose.

**Dark mode is opt-in.** Add `mso-kl--auto-dark` to the wrapper *only* if your theme
actually has a dark mode:

```html
<div class="mso-kl mso-kl--auto-dark">
```

On a light-only site, leaving it off is correct — otherwise a visitor whose OS is set
to dark gets a dark block sitting on your white page.

**Everything is scoped** under `.mso-kl`, so it cannot leak into or collide with
Elementor's own styles or your theme.

---

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
