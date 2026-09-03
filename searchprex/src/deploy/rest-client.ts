import type { GitHubClient, GitHubFile } from './github.js';

export interface RestClientConfig {
  owner: string;
  repo: string;
  token: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** GitHub REST implementation of `GitHubClient`. */
export class RestGitHubClient implements GitHubClient {
  #owner: string;
  #repo: string;
  #token: string;
  #base: string;
  #fetch: typeof fetch;

  constructor(config: RestClientConfig) {
    if (config.token.trim() === '') throw new Error('GitHub token is empty');
    this.#owner = config.owner;
    this.#repo = config.repo;
    this.#token = config.token;
    this.#base = config.apiBase ?? 'https://api.github.com';
    this.#fetch = config.fetchImpl ?? globalThis.fetch;
  }

  async getDefaultBranch(): Promise<string> {
    const repo = await this.#request<{ default_branch: string }>('GET', '');
    return repo.default_branch;
  }

  async getRefSha(branch: string): Promise<string> {
    const ref = await this.#request<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object.sha;
  }

  async createBranch(name: string, fromSha: string): Promise<void> {
    await this.#request('POST', '/git/refs', {
      ref: `refs/heads/${name}`,
      sha: fromSha,
    });
  }

  async getFile(path: string, ref: string): Promise<GitHubFile | null> {
    const response = await this.#raw(
      'GET',
      `/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw await this.#error(response, 'getFile');

    const body = (await response.json()) as { content?: string; sha: string; type: string };
    if (body.type !== 'file' || body.content === undefined) return null;

    return {
      content: Buffer.from(body.content, 'base64').toString('utf8'),
      sha: body.sha,
    };
  }

  async putFile(args: {
    path: string;
    content: string;
    message: string;
    branch: string;
    sha?: string;
  }): Promise<void> {
    await this.#request('PUT', `/contents/${encodePath(args.path)}`, {
      message: args.message,
      content: Buffer.from(args.content, 'utf8').toString('base64'),
      branch: args.branch,
      ...(args.sha === undefined ? {} : { sha: args.sha }),
    });
  }

  async createPullRequest(args: {
    title: string;
    head: string;
    base: string;
    body: string;
    draft: boolean;
  }): Promise<{ number: number; url: string }> {
    const pr = await this.#request<{ number: number; html_url: string }>('POST', '/pulls', args);
    return { number: pr.number, url: pr.html_url };
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.#raw(method, path, body);
    if (!response.ok) throw await this.#error(response, `${method} ${path}`);
    return (await response.json()) as T;
  }

  async #raw(method: string, path: string, body?: unknown): Promise<Response> {
    return this.#fetch(`${this.#base}/repos/${this.#owner}/${this.#repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async #error(response: Response, context: string): Promise<Error> {
    const text = await response.text().catch(() => '');
    // The token is in a header, never in the URL or body, so nothing here can
    // leak it into a log line.
    return new Error(`GitHub ${context} failed: ${String(response.status)} ${text.slice(0, 500)}`);
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
