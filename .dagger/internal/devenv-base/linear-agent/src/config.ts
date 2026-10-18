// Runtime configuration for the linear-agent webhook receiver. All values
// come from the environment so the same build works across dev and whatever
// process supervisor ends up running it (that's a container-use-env
// concern, not this package's).
export interface Config {
  port: number;
  linearClientId: string;
  linearClientSecret: string;
  linearWebhookSecret: string;
  /** Public callback URL registered with the Linear Application, e.g. https://agent.tidelands.dev/oauth/callback */
  oauthRedirectUrl: string;
  /**
   * The actor=app installation access token, if one has already been
   * issued. Sourced from the same Proton Pass item (pass://development/
   * agent.tidelands.dev) this process runs under via `pass-cli run
   * --env-file`, so it survives restarts without this package touching
   * local disk. Empty until the OAuth install flow has completed once, in
   * which case /oauth/callback logs the token for a human to persist back
   * into that Pass item.
   */
  linearInstallToken: string;
  /** Authenticates headless `claude` CLI invocations. */
  claudeCodeOAuthToken: string;
}

const REQUIRED_ENV_VARS = [
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "LINEAR_WEBHOOK_SECRET",
  "LINEAR_OAUTH_REDIRECT_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = REQUIRED_ENV_VARS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`missing required env vars: ${missing.join(", ")}`);
  }

  return {
    port: Number(env.PORT ?? "8080"),
    linearClientId: env.LINEAR_CLIENT_ID!,
    linearClientSecret: env.LINEAR_CLIENT_SECRET!,
    linearWebhookSecret: env.LINEAR_WEBHOOK_SECRET!,
    oauthRedirectUrl: env.LINEAR_OAUTH_REDIRECT_URL!,
    linearInstallToken: env.LINEAR_INSTALL_TOKEN ?? "",
    claudeCodeOAuthToken: env.CLAUDE_CODE_OAUTH_TOKEN!,
  };
}
