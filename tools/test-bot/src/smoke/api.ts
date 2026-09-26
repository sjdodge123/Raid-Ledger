/** One GET's body: parsed, or the SyntaxError a truncated body produced. */
type ParsedBody<T> =
  | { ok: true; value: T }
  | { ok: false; bytes: number; error: SyntaxError };

/** Thin HTTP client wrapping fetch with JWT auth. */
export class ApiClient {
  /** User ID from login response */
  userId = 0;

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  static async login(
    baseUrl: string,
    email: string,
    password: string,
  ): Promise<ApiClient> {
    const res = await fetch(`${baseUrl}/auth/local`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = (await res.json()) as {
      access_token: string;
      user: { id: number };
    };
    const client = new ApiClient(baseUrl, data.access_token);
    client.userId = data.user.id;
    return client;
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };
  }

  /**
   * A body cut off in transit fails JSON.parse with a bare "Unterminated
   * string in JSON at position N" that names no request. A GET is idempotent,
   * so it is re-fetched ONCE; a second bad body throws an error naming the path
   * and byte counts. post/put/patch are deliberately NOT retried — re-sending a
   * mutation after a truncated response would apply it twice.
   */
  async get<T = unknown>(path: string): Promise<T> {
    const first = await this.getOnce<T>(path);
    if (first.ok) return first.value;
    console.warn(
      `  [api] GET ${path} → unparseable JSON (${first.bytes} bytes): ${first.error.message} — retrying once`,
    );
    const second = await this.getOnce<T>(path);
    if (second.ok) return second.value;
    throw new Error(
      `GET ${path} → unparseable JSON body twice (${first.bytes} then ${second.bytes} bytes): ${second.error.message}`,
    );
  }

  private async getOnce<T>(path: string): Promise<ParsedBody<T>> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    const text = await res.text();
    try {
      return { ok: true, value: JSON.parse(text) as T };
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      return { ok: false, bytes: Buffer.byteLength(text, 'utf8'), error: err };
    }
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PUT ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  }
}
