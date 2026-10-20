import { env } from 'cloudflare:workers';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { Bindings } from '../../src/worker/env';

export const TEAM = 'example.cloudflareaccess.com';
export const AUD = 'test-aud-0123456789';

export async function makeKeys(): Promise<{
  sign: (claims: Record<string, unknown>, opts?: SignOpts) => Promise<string>;
  getKey: JWTVerifyGetKey;
}> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const getKey = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: SignOpts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.issuer ?? `https://${TEAM}`)
      .setAudience(opts.audience ?? AUD)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign(privateKey);
  return { sign, getKey };
}
interface SignOpts {
  issuer?: string;
  audience?: string;
  expiresIn?: string | number;
}

/** Env as deployed: Access configured, no stub. */
export function accessEnv(over: Partial<Bindings> = {}): Bindings {
  return {
    ...env,
    ENVIRONMENT: 'preview',
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    DEV_AUTH_STUB: undefined,
    ...over,
  };
}

/** Env as local dev: stub on, no Access vars. */
export function devEnv(over: Partial<Bindings> = {}): Bindings {
  return {
    ...env,
    ENVIRONMENT: 'development',
    ACCESS_TEAM_DOMAIN: undefined,
    ACCESS_AUD: undefined,
    DEV_AUTH_STUB: '1',
    DEV_AUTH_EMAIL: 'alex@example.com',
    ...over,
  };
}
