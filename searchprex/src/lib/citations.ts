import type { EngineResult } from '../engines/types.js';
import { isSameSite, registrableDomain } from './domain.js';
import { aliasesForProject, findBrandMention } from './brand.js';

export type CitationOwner = 'self' | 'competitor' | 'third_party';

export interface ClassifiedCitation {
  position: number;
  url: string;
  domain: string | null;
  title?: string;
  owner: CitationOwner;
}

export interface ProjectContext {
  domain: string;
  brandNames: string[];
  competitors: { domain: string; brandNames: string[] }[];
}

export interface ResultAnalysis {
  answered: boolean;
  brandMentioned: boolean;
  /** A citation resolved to the project's own domain. */
  brandCited: boolean;
  /** Position of the first self citation, 1-based. */
  citedAtPosition: number | null;
  firstMentionOffset: number | null;
  citations: ClassifiedCitation[];
  /** Competitor domains that were cited, deduplicated. */
  competitorDomainsCited: string[];
  /**
   * Third-party domains cited for this prompt. Aggregated across the whole
   * prompt set, this is the placement target list — the pages the engine
   * already trusts for the customer's topic.
   */
  thirdPartyDomains: string[];
}

export function classifyCitationOwner(
  url: string,
  context: ProjectContext,
): CitationOwner {
  if (isSameSite(url, context.domain)) return 'self';
  for (const competitor of context.competitors) {
    if (isSameSite(url, competitor.domain)) return 'competitor';
  }
  return 'third_party';
}

export function analyseResult(
  result: EngineResult,
  context: ProjectContext,
): ResultAnalysis {
  const citations: ClassifiedCitation[] = result.citations.map((citation) => {
    const title = citation.title;
    return {
      position: citation.position,
      url: citation.url,
      domain: registrableDomain(citation.url),
      ...(title === undefined ? {} : { title }),
      owner: classifyCitationOwner(citation.url, context),
    };
  });

  const selfCitation = citations.find((c) => c.owner === 'self');
  const mention = findBrandMention(
    result.answerText,
    aliasesForProject(context.domain, context.brandNames),
  );

  const competitorDomainsCited = unique(
    citations.filter((c) => c.owner === 'competitor').map((c) => c.domain),
  );
  const thirdPartyDomains = unique(
    citations.filter((c) => c.owner === 'third_party').map((c) => c.domain),
  );

  return {
    answered: result.answered,
    brandMentioned: mention.mentioned,
    brandCited: selfCitation !== undefined,
    citedAtPosition: selfCitation?.position ?? null,
    firstMentionOffset: mention.firstOffset,
    citations,
    competitorDomainsCited,
    thirdPartyDomains,
  };
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v !== null))].sort();
}
