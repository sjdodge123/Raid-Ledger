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

  async get<T = unknown>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json() as Promise<T>;
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
