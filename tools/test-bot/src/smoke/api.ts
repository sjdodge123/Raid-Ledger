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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface LoginResponse {
  access_token: string;
  user: { id: number };
}

/** POST /auth/local; throws `Login failed: <status>` on a non-2xx. */
async function fetchLogin(
  baseUrl: string,
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${baseUrl}/auth/local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  return parseJson<LoginResponse>('POST', '/auth/local', res);
}

/**
 * The error a non-2xx response raises. GET and DELETE name the status only;
 * the mutating verbs append the response text.
 */
async function httpError(method: Method, path: string, res: Response): Promise<Error> {
  if (method === 'GET' || method === 'DELETE') {
    return new Error(`${method} ${path} → ${res.status}`);
  }
  const text = await res.text().catch(() => '');
  return new Error(`${method} ${path} → ${res.status}: ${text}`);
}

/** Thin HTTP client wrapping fetch with JWT auth. */
export class ApiClient {
  /** User ID from login response */
  userId = 0;

  /**
   * Mints a fresh token with the credentials `login()` was given. Unset on a
   * client built from a bare JWT, which therefore never re-logs in.
   */
  private relogin?: () => Promise<string>;

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  static async login(
    baseUrl: string,
    email: string,
    password: string,
  ): Promise<ApiClient> {
    const data = await fetchLogin(baseUrl, email, password);
    const client = new ApiClient(baseUrl, data.access_token);
    client.userId = data.user.id;
    client.relogin = async () =>
      (await fetchLogin(baseUrl, email, password)).access_token;
    return client;
  }

  async get<T = unknown>(path: string): Promise<T> {
    return parseJson<T>('GET', path, await this.request('GET', path));
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const json = body ? JSON.stringify(body) : undefined;
    return parseJson<T>('POST', path, await this.request('POST', path, json));
  }

  async put<T = unknown>(path: string, body: unknown): Promise<T> {
    const json = JSON.stringify(body);
    return parseJson<T>('PUT', path, await this.request('PUT', path, json));
  }

  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    const json = JSON.stringify(body);
    return parseJson<T>('PATCH', path, await this.request('PATCH', path, json));
  }

  async delete(path: string): Promise<void> {
    await this.request('DELETE', path);
  }

  /**
   * Send once and return the 2xx response, or throw the verb's error.
   *
   * A 401 on a login-made client means the JWT expired mid-suite (1h
   * lifetime): re-login ONCE, swap the token and re-send ONCE. The API
   * rejects a 401 before any handler runs, so the re-send cannot apply a
   * mutation twice. A second 401 throws the normal error; a failed re-login
   * throws the original 401 error with the re-login failure as its cause.
   * No other status is ever re-sent.
   */
  private async request(method: Method, path: string, body?: string): Promise<Response> {
    let res = await this.send(method, path, body);
    if (res.status === 401 && this.relogin) {
      const original = await httpError(method, path, res);
      try {
        this.token = await this.relogin();
      } catch (err) {
        throw new Error(original.message, { cause: err });
      }
      res = await this.send(method, path, body);
    }
    if (!res.ok) throw await httpError(method, path, res);
    return res;
  }

  private send(method: Method, path: string, body?: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body,
    });
  }
}
