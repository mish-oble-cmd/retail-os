/**
 * @retailos/api-client — typed fetch wrapper over the generated OpenAPI types.
 * NEVER hand-edit src/generated/** (monorepo-structure.md rule 5): change
 * apps/api (the spec source), rebuild, and this package regenerates.
 */
import type { paths } from './generated/schema.js';

export type ApiPaths = paths;

export interface ApiClientOptions {
  baseUrl: string;
  /** Override for tests / React Native. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ProblemJson {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: Array<{ field: string; code: string; message: string }>;
}

export class ApiError extends Error {
  constructor(readonly problem: ProblemJson) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

export type ApiPath = keyof paths & string;

/**
 * Thin typed client (Phase 0): path names are checked against the generated
 * spec; request/response payload types tighten in Phase 1 when the spec
 * carries full schemas. Sessions ride on cookies (credentials: "include").
 */
export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: ApiPath,
    body?: unknown,
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const problem = (await response.json().catch(() => null)) as ProblemJson | null;
      throw new ApiError(
        problem ?? { type: 'about:blank', title: response.statusText, status: response.status },
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    get: <T>(path: ApiPath) => request<T>('GET', path),
    post: <T>(path: ApiPath, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: ApiPath, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: ApiPath) => request<T>('DELETE', path),
  };
}
