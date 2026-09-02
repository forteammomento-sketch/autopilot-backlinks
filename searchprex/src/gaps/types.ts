export type GapType =
  | 'bot_blocked'
  | 'js_only'
  | 'no_page'
  | 'weak_passage'
  | 'no_schema'
  | 'orphan'
  | 'rival_corroborated'
  | 'not_ranking';

export type Certainty = 'proven' | 'strong' | 'plausible';

export interface Gap {
  prompt: string;
  engine: string;
  gapType: GapType;
  /** Which of the four gates this failure sits at. See the spec, section 1. */
  blockedAtGate: 1 | 2 | 3 | 4;
  ourUrl: string | null;
  rivalUrl: string | null;
  certainty: Certainty;
  /** Everything the UI needs to justify the finding to a sceptical customer. */
  evidence: Record<string, unknown>;
}

export interface PageEvidence {
  url: string;
  httpStatus: number;
  /** Raw HTML as fetched without JavaScript — what the crawler sees. */
  html: string;
  /** Word count after JS execution, when a rendered fetch was also performed. */
  renderedWords?: number;
  /** Internal inbound links, from the site crawl. */
  internalInboundLinks?: number;
  /** Classic organic position for the closest matching query, when known. */
  organicPosition?: number;
  /** Schema types this page ought to carry. Defaults to Product/FAQPage/Article. */
  expectedSchemaTypes?: string[];
}

export interface SiteEvidence {
  /** robots.txt body, or null when it could not be fetched. */
  robotsTxt: string | null;
  /** The owned page most topically relevant to this prompt, if any exists. */
  candidatePage: PageEvidence | null;
}

export interface DetectionResult {
  gaps: Gap[];
  /**
   * The earliest-gate gap. Only this one should produce a content action:
   * generating an answer block for a page that robots.txt blocks is work that
   * cannot possibly pay off, and shipping it anyway is how a tool burns a
   * customer's trust and their content budget at the same time.
   */
  blocking: Gap | null;
}
