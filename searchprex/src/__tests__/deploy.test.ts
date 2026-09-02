import { describe, expect, it, vi } from 'vitest';
import { applyAnswerBlock, applyCrawlFix, applySchema, removeBlock } from '../deploy/apply.js';
import { blockId, markedIds } from '../deploy/markers.js';
import { buildDeployPlan, staticSiteResolver } from '../deploy/plan.js';
import { deployViaPullRequest, rollbackViaPullRequest, type GitHubClient } from '../deploy/github.js';
import type { Action, AnswerBlockArtifact, CrawlFixArtifact, SchemaArtifact } from '../actions/types.js';
import type { Gap } from '../gaps/types.js';

const BLOCK: AnswerBlockArtifact = {
  kind: 'answer_block',
  question: 'How long does a barlow knife blade stay sharp?',
  answer: 'About two weeks in 1095 carbon steel.',
  supporting: [],
  factsUsed: ['blade steel'],
  html: '<section class="sp-answer"><h2>How long?</h2><p>About two weeks.</p></section>',
};

const SCHEMA: SchemaArtifact = {
  kind: 'schema',
  types: ['Product'],
  jsonLd: { '@type': 'Product', name: 'Barlow' },
  html: '<script type="application/ld+json">{"@type":"Product","name":"Barlow"}</script>',
};

const PAGE = `<html><head><title>Barlow</title></head><body><main><h1>Barlow</h1></main><footer>f</footer></body></html>`;

function gap(overrides: Partial<Gap> = {}): Gap {
  return {
    prompt: 'how long does a barlow knife blade stay sharp',
    engine: 'perplexity',
    gapType: 'weak_passage',
    blockedAtGate: 3,
    ourUrl: 'https://mso.com/products/barlow',
    rivalUrl: null,
    certainty: 'proven',
    evidence: { reason: 'thin' },
    ...overrides,
  };
}

function action(overrides: Partial<Action> = {}): Action {
  return {
    actionType: 'answer_block',
    gap: gap(),
    targetUrl: 'https://mso.com/products/barlow',
    priority: 1,
    certainty: 'proven',
    artifact: BLOCK,
    rationale: 'states the answer from first-party facts',
    ...overrides,
  };
}

describe('applyAnswerBlock', () => {
  it('inserts inside main, not after the footer', () => {
    // A block appended after the footer is in the DOM but outside the region
    // extractors treat as the page body — the action would be wasted.
    const result = applyAnswerBlock(PAGE, BLOCK);
    expect(result.changed).toBe(true);
    expect(result.content.indexOf('sp-answer')).toBeLessThan(result.content.indexOf('</main>'));
  });

  it('is idempotent — a second deploy replaces rather than appends', () => {
    const once = applyAnswerBlock(PAGE, BLOCK).content;
    const twice = applyAnswerBlock(once, BLOCK);

    expect(twice.changed).toBe(false);
    expect(twice.skipped).toContain('already present');
    expect(count(once, 'sp-answer')).toBe(1);
  });

  it('updates a changed block in place', () => {
    const once = applyAnswerBlock(PAGE, BLOCK).content;
    const revised = applyAnswerBlock(once, { ...BLOCK, html: '<section class="sp-answer">new</section>' });

    expect(revised.changed).toBe(true);
    expect(count(revised.content, 'sp-answer')).toBe(1);
    expect(revised.content).toContain('new');
  });

  it('falls back to before the footer when there is no main', () => {
    const result = applyAnswerBlock('<body><footer>f</footer></body>', BLOCK).content;
    expect(result.indexOf('sp-answer')).toBeLessThan(result.indexOf('<footer'));
  });

  it('appends when the page has no landmarks at all', () => {
    expect(applyAnswerBlock('<p>bare</p>', BLOCK).content).toContain('sp-answer');
  });

  it('leaves a removable marker', () => {
    const withBlock = applyAnswerBlock(PAGE, BLOCK).content;
    expect(markedIds(withBlock)).toEqual([blockId(BLOCK.question)]);

    const removed = removeBlock(withBlock, blockId(BLOCK.question));
    expect(removed.changed).toBe(true);
    expect(removed.content).not.toContain('sp-answer');
  });
});

describe('applySchema', () => {
  it('adds JSON-LD to the head', () => {
    const result = applySchema(PAGE, SCHEMA);
    expect(result.changed).toBe(true);
    expect(result.content.indexOf('ld+json')).toBeLessThan(result.content.indexOf('</head>'));
  });

  it('refuses to add a second block of a type the page already has', () => {
    // Two competing Product blocks is worse than none: engines pick one
    // unpredictably and the conflict is one we created.
    const existing = PAGE.replace(
      '</head>',
      '<script type="application/ld+json">{"@type":"Product","name":"Other"}</script></head>',
    );
    const result = applySchema(existing, SCHEMA);
    expect(result.changed).toBe(false);
    expect(result.skipped).toContain('already has Product');
  });
});

describe('applyCrawlFix', () => {
  it('appends an allow group', () => {
    const artifact: CrawlFixArtifact = {
      kind: 'crawl_fix',
      layer: 'robots',
      robotsAdditions: ['User-agent: PerplexityBot', 'Allow: /', ''],
      note: '',
    };
    const result = applyCrawlFix('User-agent: *\nDisallow: /admin\n', artifact);
    expect(result.changed).toBe(true);
    expect(result.content).toContain('User-agent: PerplexityBot');
    expect(result.content).toContain('Disallow: /admin');
  });

  it('will not rewrite a group somebody configured deliberately', () => {
    const artifact: CrawlFixArtifact = {
      kind: 'crawl_fix',
      layer: 'robots',
      robotsAdditions: ['User-agent: PerplexityBot', 'Allow: /', ''],
      note: '',
    };
    const result = applyCrawlFix('User-agent: PerplexityBot\nDisallow: /\n', artifact);
    expect(result.changed).toBe(false);
    expect(result.skipped).toContain('Edit it by hand');
  });

  it('does not touch robots.txt for an edge-level block', () => {
    const artifact: CrawlFixArtifact = {
      kind: 'crawl_fix',
      layer: 'edge',
      robotsAdditions: [],
      note: 'WAF',
    };
    expect(applyCrawlFix('User-agent: *\n', artifact).changed).toBe(false);
  });
});

describe('staticSiteResolver', () => {
  it('maps URLs to files and refuses what it cannot map', () => {
    const resolve = staticSiteResolver('site');
    expect(resolve('https://mso.com/products/barlow')).toBe('site/products/barlow.html');
    expect(resolve('https://mso.com/')).toBe('site/index.html');
    expect(resolve('https://mso.com/a/b.html')).toBe('site/a/b.html');
    expect(resolve('not a url')).toBeNull();
  });
});

describe('buildDeployPlan', () => {
  const files: Record<string, string> = {
    'products/barlow.html': PAGE,
    'robots.txt': 'User-agent: *\nAllow: /\n',
  };
  const readFile = async (path: string): Promise<string | null> => files[path] ?? null;
  const resolver = staticSiteResolver();

  it('folds two actions on one page into one change, keeping the original as before', async () => {
    // The trap: applying the second action to the original would discard the
    // first. `before` must still be the untouched file, since that is the
    // rollback.
    const plan = await buildDeployPlan(
      [action({ priority: 2 }), action({ actionType: 'schema', artifact: SCHEMA, priority: 1 })],
      { readFile, resolver },
    );

    expect(plan.changes).toHaveLength(1);
    const change = plan.changes[0]!;
    expect(change.before).toBe(PAGE);
    expect(change.after).toContain('sp-answer');
    expect(change.after).toContain('ld+json');
    expect(change.applied.map((a) => a.actionType)).toEqual(['answer_block', 'schema']);
  });

  it('caps answer blocks per run and keeps the highest priority ones', async () => {
    const many = [3, 2, 1].map((priority, i) =>
      action({
        priority,
        artifact: { ...BLOCK, question: `Question ${String(i)}?` },
      }),
    );
    const plan = await buildDeployPlan(many, { readFile, resolver, maxBlocksPerRun: 2 });

    expect(plan.cappedCount).toBe(1);
    expect(plan.changes[0]!.applied).toHaveLength(2);
    expect(plan.skipped.some((s) => s.reason.includes('per-run cap'))).toBe(true);
  });

  it('skips an action it cannot map to a file', async () => {
    const plan = await buildDeployPlan([action({ targetUrl: 'https://mso.com/missing' })], {
      readFile,
      resolver,
    });
    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toContain('does not exist');
  });

  it('records rank_first as advisory rather than a failure', async () => {
    const plan = await buildDeployPlan(
      [action({ actionType: 'rank_first', artifact: null })],
      { readFile, resolver },
    );
    expect(plan.skipped[0]!.reason).toContain('advisory');
  });

  it('routes a crawl_fix to robots.txt', async () => {
    const artifact: CrawlFixArtifact = {
      kind: 'crawl_fix',
      layer: 'robots',
      robotsAdditions: ['User-agent: PerplexityBot', 'Allow: /', ''],
      note: '',
    };
    const plan = await buildDeployPlan(
      [action({ actionType: 'crawl_fix', artifact, targetUrl: null })],
      { readFile, resolver },
    );
    expect(plan.changes[0]!.path).toBe('robots.txt');
  });

  it('produces no change when the block is already deployed', async () => {
    const deployed: Record<string, string> = {
      ...files,
      'products/barlow.html': applyAnswerBlock(PAGE, BLOCK).content,
    };
    const plan = await buildDeployPlan([action()], {
      readFile: async (p) => deployed[p] ?? null,
      resolver,
    });
    expect(plan.changes).toHaveLength(0);
  });
});

function fakeClient(files: Record<string, string>) {
  const written: { path: string; content: string; branch: string }[] = [];
  const branches: string[] = [];
  const prs: { title: string; body: string; draft: boolean }[] = [];

  const client: GitHubClient = {
    getDefaultBranch: async () => 'main',
    getRefSha: async () => 'basesha',
    createBranch: async (name) => {
      branches.push(name);
    },
    getFile: async (path) =>
      files[path] === undefined ? null : { content: files[path], sha: `sha-${path}` },
    putFile: async ({ path, content, branch }) => {
      files[path] = content;
      written.push({ path, content, branch });
    },
    createPullRequest: async (args) => {
      prs.push({ title: args.title, body: args.body, draft: args.draft });
      return { number: 7, url: 'https://github.com/o/r/pull/7' };
    },
  };

  return { client, written, branches, prs, files };
}

describe('deployViaPullRequest', () => {
  const plan = {
    changes: [
      {
        path: 'products/barlow.html',
        before: PAGE,
        after: `${PAGE}<!-- changed -->`,
        applied: [{ actionType: 'answer_block' as const, rationale: 'because' }],
      },
    ],
    skipped: [],
    cappedCount: 0,
  };

  it('opens a draft PR on a new branch and never touches the base', async () => {
    const fake = fakeClient({ 'products/barlow.html': PAGE });
    const record = await deployViaPullRequest(plan, fake.client);

    expect(record).not.toBeNull();
    expect(fake.branches).toHaveLength(1);
    expect(fake.written.every((w) => w.branch !== 'main')).toBe(true);
    expect(fake.prs[0]!.draft).toBe(true);
    expect(record!.files[0]!.before).toBe(PAGE);
  });

  it('refuses to overwrite a file that changed since the plan was built', async () => {
    const fake = fakeClient({ 'products/barlow.html': '<html>someone else edited this</html>' });
    await expect(deployViaPullRequest(plan, fake.client)).rejects.toThrow('changed since the plan');
    expect(fake.written).toHaveLength(0);
  });

  it('does nothing when the plan is empty', async () => {
    const fake = fakeClient({});
    expect(await deployViaPullRequest({ changes: [], skipped: [], cappedCount: 0 }, fake.client))
      .toBeNull();
    expect(fake.branches).toHaveLength(0);
  });

  it('explains held-back blocks in the PR body', async () => {
    const fake = fakeClient({ 'products/barlow.html': PAGE });
    await deployViaPullRequest({ ...plan, cappedCount: 3 }, fake.client);
    expect(fake.prs[0]!.body).toContain('held back by the per-run cap');
  });
});

describe('rollbackViaPullRequest', () => {
  it('restores the snapshot as a revert PR rather than rewriting history', async () => {
    const fake = fakeClient({ 'products/barlow.html': `${PAGE}<!-- changed -->` });
    const pr = await rollbackViaPullRequest(
      {
        method: 'github_pr',
        branch: 'searchprex/2026-09-02',
        baseBranch: 'main',
        files: [{ path: 'products/barlow.html', before: PAGE }],
        deployedAt: new Date().toISOString(),
      },
      fake.client,
    );

    expect(pr.number).toBe(7);
    expect(fake.files['products/barlow.html']).toBe(PAGE);
    expect(fake.prs[0]!.title).toContain('Revert');
  });
});

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
