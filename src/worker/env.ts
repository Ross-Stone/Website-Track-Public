import type { Role } from '../shared/constants';

export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  /** "development" (local only), "preview" or "production". */
  ENVIRONMENT: string;
  /** Access team domain, e.g. your-team.cloudflareaccess.com. Always set when deployed. */
  ACCESS_TEAM_DOMAIN?: string;
  /** Access application audience (AUD) tag. Always set when deployed. */
  ACCESS_AUD?: string;
  /** Local dev only: "1" turns on the dev auth stub (from .dev.vars). Refused when Access is configured. */
  DEV_AUTH_STUB?: string;
  /** Local dev only: default stub user email. */
  DEV_AUTH_EMAIL?: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: {
    /** Verified email from Access (or the dev stub). */
    authEmail: string;
    user: CurrentUser;
  };
}
