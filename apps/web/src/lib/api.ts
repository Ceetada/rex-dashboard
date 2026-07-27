/**
 * The single door to the API.
 *
 * Nothing in the app calls `fetch` directly. Centralising it is what makes
 * three things possible in one place: cookies always sent, the CSRF header
 * always attached, and a 401 handled by one silent refresh rather than by
 * dumping the user on the login screen mid-task.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { fields?: Record<string, string[]> } & Record<string, unknown>;
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: Record<string, string[]>;
  /** Shown in support-facing error UI so a user can quote it. */
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.fields = body.error.details?.fields;
    this.requestId = body.error.requestId;
  }
}

/**
 * A single in-flight refresh, shared by every caller.
 *
 * Without this, a dashboard that fires six requests on load and gets six 401s
 * would kick off six refreshes — five of which present an already-rotated
 * token and trip the reuse detector, logging the user out. This promise is the
 * fix, and the reason it exists is not obvious from the code alone.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe this result
      // before a new refresh can start.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();
  return refreshInFlight;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Set for mutations that must not be applied twice. */
  idempotencyKey?: string;
  /** Internal: prevents an infinite retry loop after a failed refresh. */
  _retried?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, _retried, headers, ...rest } = options;

  const response = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    // Session cookies are HttpOnly, so they only travel if we ask for them.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && !_retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...options, _retried: true });
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({
      error: { code: 'NETWORK_ERROR', message: 'We could not reach Evas. Check your connection.' },
    }))) as ApiErrorBody;
    throw new ApiError(response.status, payload);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown, idempotencyKey?: string) =>
  api<T>(path, { method: 'POST', body, ...(idempotencyKey ? { idempotencyKey } : {}) });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

/**
 * Generates the idempotency key for a purchase.
 *
 * Generated once when the form mounts and reused across retries, so tapping
 * "Buy" twice on a slow connection sends the same key and the server replays
 * the original result instead of charging again.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
