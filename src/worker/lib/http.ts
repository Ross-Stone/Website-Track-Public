import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiException } from '../errors';

function describe(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid request.';
  const path = first.path.join('.');
  return path ? `${path}: ${first.message}` : first.message;
}

/** Parses the JSON body with a zod schema, or throws a 400 validation error. */
export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiException(400, 'validation', 'Request body must be JSON.');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiException(400, 'validation', describe(r.error));
  return r.data;
}

/** Parses the query string with a zod schema, or throws a 400 validation error. */
export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.output<S> {
  const r = schema.safeParse(c.req.query());
  if (!r.success) throw new ApiException(400, 'validation', describe(r.error));
  return r.data;
}

export function notFound(what: string): never {
  throw new ApiException(404, 'not_found', `${what} not found.`);
}

export function invalid(message: string): never {
  throw new ApiException(400, 'validation', message);
}

export const nowIso = () => new Date().toISOString();
