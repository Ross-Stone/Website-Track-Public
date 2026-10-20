import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

// One JWKS per team domain per isolate. jose caches keys and refetches on unknown `kid`.
const jwksByTeam = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verifies a Cf-Access-Jwt-Assertion token (TECH-05): signature against the team's public keys,
 * issuer, audience (the environment's AUD tag) and expiry. Returns the verified email, lowercased,
 * or null if the token is invalid or has no email (e.g. a service token).
 */
export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string },
  getKey: JWTVerifyGetKey = remoteJwks(opts.teamDomain),
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: `https://${opts.teamDomain}`,
      audience: opts.aud,
      algorithms: ['RS256'],
    });
    const email = payload['email'];
    if (typeof email !== 'string' || !email.includes('@')) return null;
    return email.trim().toLowerCase();
  } catch {
    return null;
  }
}
