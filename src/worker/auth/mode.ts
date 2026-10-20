import type { Bindings } from '../env';

export type AuthMode =
  | { kind: 'access'; teamDomain: string; aud: string }
  | { kind: 'dev'; defaultEmail: string | undefined }
  | { kind: 'misconfigured'; reason: string };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEPLOYED_ENVIRONMENTS = new Set(['production', 'preview']);

/**
 * Decides how a request is authenticated. Fails closed: anything unexpected is "misconfigured",
 * and the middleware answers 500 without touching data.
 *
 * The dev stub runs only when ALL of these hold:
 *   - DEV_AUTH_STUB is exactly "1" (it only ever comes from the gitignored .dev.vars or a local --var)
 *   - no Access team domain or AUD is configured (production and preview always set both)
 *   - ENVIRONMENT is not a deployed environment
 *   - the request hostname is localhost or 127.0.0.1
 */
export function resolveAuthMode(env: Bindings, requestUrl: string): AuthMode {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  const stubRequested = env.DEV_AUTH_STUB !== undefined && env.DEV_AUTH_STUB !== '';

  if (stubRequested) {
    if (env.DEV_AUTH_STUB !== '1')
      return { kind: 'misconfigured', reason: 'DEV_AUTH_STUB must be "1" or unset' };
    if (team || aud) return { kind: 'misconfigured', reason: 'dev auth stub refused: Access is configured' };
    if (DEPLOYED_ENVIRONMENTS.has(env.ENVIRONMENT)) {
      return { kind: 'misconfigured', reason: `dev auth stub refused in ${env.ENVIRONMENT}` };
    }
    let hostname: string;
    try {
      hostname = new URL(requestUrl).hostname;
    } catch {
      return { kind: 'misconfigured', reason: 'invalid request URL' };
    }
    if (!LOCAL_HOSTS.has(hostname)) {
      return { kind: 'misconfigured', reason: 'dev auth stub refused: not a local request' };
    }
    return { kind: 'dev', defaultEmail: env.DEV_AUTH_EMAIL };
  }

  if (team && aud) return { kind: 'access', teamDomain: team, aud };
  return { kind: 'misconfigured', reason: 'Access team domain and AUD must both be configured' };
}
