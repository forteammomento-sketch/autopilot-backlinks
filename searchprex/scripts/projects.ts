import type { ProjectContext } from '../src/lib/citations.js';

/**
 * The live project the scripts default to.
 *
 * `www` is kept because that is the host the site actually serves; citation
 * matching reduces to the registrable domain anyway, so `www` and the apex
 * both resolve to the same site.
 */
export const MSO = {
  origin: 'https://www.michigansportsoutdoor.com/',
  context: {
    domain: 'michigansportsoutdoor.com',
    brandNames: ['Michigan Sports Outdoor', 'Michigan Sports and Outdoor', 'MSO'],
    competitors: [
      { domain: 'bladehq.com', brandNames: ['Blade HQ'] },
      { domain: 'knifecenter.com', brandNames: ['KnifeCenter'] },
      { domain: 'smkw.com', brandNames: ['Smoky Mountain Knife Works'] },
      { domain: 'chicagoknifeworks.com', brandNames: ['Chicago Knife Works'] },
      { domain: 'opticsplanet.com', brandNames: ['OpticsPlanet'] },
    ],
  } satisfies ProjectContext,
};
