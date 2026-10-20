// Fetch wrapper for /api. Turns responses into typed results or one of a few error kinds the UI handles:
//   AuthExpiredError  – Access session gone (redirect to the Access login, or a 401) → "Sign in again" (FR-AUTH-04)
//   NotAllowedError   – signed in but not in the user list → "You don't have access" (FR-AUTH-02)
//   NetworkError      – offline or the request never completed (FR-SYNC-04: keep the form, allow retry)
//   ApiRequestError   – the API answered with { error: { code, message } }
import { ApiError, type ErrorCode } from '../../shared/api';

export class AuthExpiredError extends Error {
  constructor() {
    super('Your sign-in has expired.');
  }
}
export class NotAllowedError extends Error {}
export class NetworkError extends Error {
  constructor() {
    super("Couldn't reach Track. Check your connection and try again.");
  }
}
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type Listener = (e: AuthExpiredError | NotAllowedError) => void;
const authListeners = new Set<Listener>();
/** The app shell listens for auth problems from any request. */
export function onAuthProblem(fn: Listener): () => void {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

/** A body that is already JSON text, sent as it is (import chunks). */
export class JsonText {
  constructor(readonly text: string) {}
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      // "manual" so an expired Access session shows up as a redirect instead of an HTML login page.
      redirect: 'manual',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : body instanceof JsonText ? body.text : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }
  const type = res.headers.get('content-type') ?? '';
  const authGone =
    res.type === 'opaqueredirect' ||
    res.status === 0 ||
    (res.status >= 300 && res.status < 400) ||
    res.status === 401 ||
    // Access itself can answer 403 with an HTML page; our API always answers JSON.
    (res.status === 403 && !type.includes('application/json'));
  if (authGone) {
    const e = new AuthExpiredError();
    authListeners.forEach((l) => l(e));
    throw e;
  }
  if (!res.ok) {
    let parsed: ApiError | null = null;
    try {
      const r = ApiError.safeParse(await res.json());
      parsed = r.success ? r.data : null;
    } catch {
      /* not JSON */
    }
    if (parsed?.error.code === 'not_allowed') {
      const e = new NotAllowedError(parsed.error.message);
      authListeners.forEach((l) => l(e));
      throw e;
    }
    throw new ApiRequestError(
      res.status,
      parsed?.error.code ?? 'internal',
      parsed?.error.message ?? 'Something went wrong. Please try again.',
    );
  }
  return res;
}

export async function apiJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await request(method, path, body);
  return (await res.json()) as T;
}

/** For requests whose response has no body (204). */
export async function apiSend(method: string, path: string, body?: unknown): Promise<void> {
  await request(method, path, body);
}

export async function apiBlob(path: string): Promise<Blob> {
  return (await request('GET', path)).blob();
}

/** A message suitable for showing next to a form. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Something went wrong. Please try again.';
}
