import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode } from '../shared/api';

/** Thrown anywhere in a handler; rendered as `{ error: { code, message } }` by the app's onError. */
export class ApiException extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, status: ContentfulStatusCode, code: ErrorCode, message: string) {
  return c.json({ error: { code, message } }, status);
}

/** Collects the message of an error and its causes (Drizzle wraps D1 errors). */
function messages(err: unknown): string {
  const out: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 5; i++) {
    if (e instanceof Error) {
      out.push(e.message);
      e = (e as { cause?: unknown }).cause;
    } else {
      out.push(String(e));
      break;
    }
  }
  return out.join(' | ');
}

/**
 * Maps database failures to API errors. Constraint failures are conflicts. Anything else from D1
 * (daily limits, outages) is 503 so the app shows a clear error instead of appearing to save (TECH-14).
 */
export function classifyError(err: unknown): ApiException | null {
  if (err instanceof ApiException) return err;
  const text = messages(err);
  if (/UNIQUE constraint failed|FOREIGN KEY constraint failed|CHECK constraint failed/i.test(text)) {
    return new ApiException(
      409,
      'conflict',
      'That change conflicts with existing data. Refresh and try again.',
    );
  }
  if (/D1_|D1 DB|SQLITE_|database|exceeded|limit/i.test(text)) {
    return new ApiException(
      503,
      'unavailable',
      "Couldn't reach the database. Nothing was saved. Please try again later.",
    );
  }
  return null;
}
