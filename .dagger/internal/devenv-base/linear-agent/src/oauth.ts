import type { Config } from "./config.ts";

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";

// The scopes this agent needs: assignable so it can be delegated an issue,
// mentionable so it can also be @-mentioned directly.
const SCOPES = ["app:assignable", "app:mentionable"];

/**
 * Builds the URL an admin visits to install this agent into a workspace.
 * actor=app switches Linear into app-installation mode (see
 * https://linear.app/developers/agents) — the resulting token acts as the
 * agent's own app user, not as the installing human.
 */
export function authorizeUrl(cfg: Config): string {
  const params = new URLSearchParams({
    client_id: cfg.linearClientId,
    redirect_uri: cfg.oauthRedirectUrl,
    response_type: "code",
    scope: SCOPES.join(","),
    actor: "app",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

/** Exchanges the OAuth authorization code from /oauth/callback for an installation access token. */
export async function exchangeCode(cfg: Config, code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.linearClientId,
    client_secret: cfg.linearClientSecret,
    redirect_uri: cfg.oauthRedirectUrl,
    code,
    grant_type: "authorization_code",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as TokenResponse;
}
