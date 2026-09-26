/** An error's message, whatever was thrown. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Read and parse a 2xx JSON body. A body cut off in transit fails with a bare
 * "Unterminated string in JSON at position N" (or undici's "terminated" when
 * the stream itself breaks) that names no request. Both are re-thrown naming
 * the method, the path and — for a parse failure — the byte count received.
 *
 * Nothing is retried: a truncated body from the API under test is a defect to
 * surface, not one to paper over on a green run, and re-sending a mutation
 * after a truncated response would apply it twice.
 */
async function parseJson<T>(method: string, path: string, res: Response): Promise<T> {
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new Error(`${method} ${path} → body read failed: ${errMsg(err)}`, { cause: err });
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const bytes = Buffer.byteLength(text, 'utf8');
    throw new Error(`${method} ${path} → unparseable JSON (${bytes} bytes): ${errMsg(err)}`, {
      cause: err,
    });
  }
}

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
    const data = await parseJson<{
      access_token: string;
      user: { id: number };
    }>('POST', '/auth/local', res);
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

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return parseJson<T>('GET', path, res);
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
    return parseJson<T>('POST', path, res);
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
    return parseJson<T>('PUT', path, res);
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
    return parseJson<T>('PATCH', path, res);
  }

  async delete(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  }
}
