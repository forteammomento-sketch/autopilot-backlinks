import { EngineError, kindForStatus } from '../engines/errors.js';
import type { PromptWriter, PromptWriterRequest } from './types.js';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o';

export interface OpenAIWriterConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Prompt writer over the OpenAI Responses API.
 *
 * No web search tool here — this is a writing task, not a retrieval one, and
 * grounding it would cost more and drift toward whatever the model happened to
 * read rather than what the customer actually stocks.
 *
 * The instruction below is the whole product decision in this file. Asked for
 * "keywords", a model returns noun phrases; asked for "questions", it returns
 * FAQ headings. Neither is what someone types into an answer engine, and every
 * one that comes back wrong is a paid measurement of a question nobody asks.
 */
export class OpenAIPromptWriter implements PromptWriter {
  #apiKey: string;
  #model: string;
  #endpoint: string;
  #fetch: typeof fetch;

  constructor(config: OpenAIWriterConfig) {
    if (config.apiKey.trim() === '') {
      throw new EngineError('auth', 'openai', 'OPENAI_API_KEY is empty');
    }
    this.#apiKey = config.apiKey;
    this.#model = config.model ?? DEFAULT_MODEL;
    this.#endpoint = config.endpoint ?? ENDPOINT;
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async write(request: PromptWriterRequest): Promise<string[]> {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.#model,
        instructions: instructions(request),
        input: `Topic: ${request.topic}\nProduct or category: ${request.seed.text}`,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new EngineError(
        kindForStatus(response.status),
        'openai',
        `prompt generation failed: HTTP ${response.status}`,
        { status: response.status, body: body.slice(0, 500) },
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    return parseLines(extractText(payload)).slice(0, request.count);
  }
}

function instructions(request: PromptWriterRequest): string {
  return [
    'You write the questions a shopper types into an AI assistant when they are',
    'deciding what to buy. Not keywords, and not FAQ headings — the actual',
    'sentence a person types.',
    '',
    `Write ${String(request.count)} of them about the product or category given.`,
    `Favour these intents, in order: ${request.intents.join(', ')}.`,
    '',
    'Rules:',
    '- Four to fifteen words each.',
    '- Never name a specific shop or retailer. A question that names the shop is',
    '  one that shop always wins, so it measures nothing.',
    '- Be specific: a price ceiling, a use case, a material, a comparison.',
    '- No numbering, no bullets, no quotes. One question per line.',
  ].join('\n');
}

function extractText(body: Record<string, unknown>): string {
  const output = body['output'];
  if (!Array.isArray(output)) return '';

  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const node = item as Record<string, unknown>;
    if (node['type'] !== 'message') continue;

    const content = node['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const text = (part as Record<string, unknown>)['text'];
      if (typeof text === 'string') chunks.push(text);
    }
  }
  return chunks.join('\n');
}

/** Strip the numbering, bullets and quotes models add despite being asked not to. */
function parseLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^["'“”]|["'“”]$/g, '')
        .trim(),
    )
    .filter((line) => line !== '');
}
