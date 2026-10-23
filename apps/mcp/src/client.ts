/**
 * A small client for the harness API. It talks to a running API over HTTP, or to the
 * app in this process (`app.fetch`), with the same calls either way.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export type Fetch = (request: Request) => Response | Promise<Response>;

export class ApiClient {
  /**
   * @param base Where the API is reachable, e.g. http://localhost:8787. Links in results point here.
   * @param fetcher Defaults to the network; pass `app.fetch` to call an app in this process.
   */
  constructor(
    readonly base: string,
    private fetcher: Fetch = (r) => fetch(r),
  ) {
    this.base = base.replace(/\/+$/, "");
  }

  /** A link to an API path, for people and agents to open. */
  link(path: string) {
    return `${this.base}${path}`;
  }

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await this.fetcher(new Request(this.link(path), init));
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {}
      const error = (parsed as { error?: string } | null)?.error ?? (text || res.statusText);
      throw new ApiError(res.status, `${method} ${path}: ${error}`, parsed);
    }
    return res;
  }

  async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.request(method, path, body)).json() as Promise<T>;
  }

  async text(path: string): Promise<string> {
    return (await this.request("GET", path)).text();
  }
}
