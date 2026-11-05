// Runtime configuration for the linear-agent webhook receiver. All values
// come from the environment so the same build works across dev and whatever
// process supervisor ends up running it (that's a container-use-env
// concern, not this package's).
//
// One build serves two Linear agents, each its own OAuth app, process, port
// and env file: AGENT_RUNTIME=claude (the default; the Claude Agent SDK) and
// AGENT_RUNTIME=openrouter (@openrouter/agent, an open-weight model on
// OpenRouter). Only the model side differs; see runner.ts.
export type Runtime = "claude" | "openrouter";

export interface OpenRouterConfig {
  apiKey: string;
  /**
   * A model id such as `qwen/qwen3-coder`. Empty means the cheapest
   * open-weight model with tool calling that OpenRouter lists, resolved when
   * a turn starts (models.ts).
   */
  model: string;
  /** A turn stops once OpenRouter reports it has cost this many dollars. */
  maxCostUsd: number;
  /** A turn stops after this many model calls. */
  maxSteps: number;
}

export interface Config {
  port: number;
  runtime: Runtime;
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
  /** Linear GraphQL endpoint; only tests set it, to keep them off the network. */
  linearApiUrl?: string;
  /** Authenticates headless `claude` CLI invocations (runtime claude). */
  claudeCodeOAuthToken: string;
  /** Runtime openrouter only. */
  openrouter?: OpenRouterConfig;
}

const LINEAR_ENV_VARS = [
  "LINEAR_CLIENT_ID",
  "LINEAR_CLIENT_SECRET",
  "LINEAR_WEBHOOK_SECRET",
  "LINEAR_OAUTH_REDIRECT_URL",
] as const;

const RUNTIME_ENV_VARS: Record<Runtime, readonly string[]> = {
  claude: ["CLAUDE_CODE_OAUTH_TOKEN"],
  openrouter: ["OPENROUTER_API_KEY"],
};

function positive(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const runtime = (env.AGENT_RUNTIME || "claude") as Runtime;
  if (!(runtime in RUNTIME_ENV_VARS)) {
    throw new Error(`AGENT_RUNTIME must be claude or openrouter, got ${JSON.stringify(env.AGENT_RUNTIME)}`);
  }
  const missing = [...LINEAR_ENV_VARS, ...RUNTIME_ENV_VARS[runtime]].filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`missing required env vars: ${missing.join(", ")}`);
  }

  return {
    port: Number(env.PORT ?? "8080"),
    runtime,
    linearClientId: env.LINEAR_CLIENT_ID!,
    linearClientSecret: env.LINEAR_CLIENT_SECRET!,
    linearWebhookSecret: env.LINEAR_WEBHOOK_SECRET!,
    oauthRedirectUrl: env.LINEAR_OAUTH_REDIRECT_URL!,
    linearInstallToken: env.LINEAR_INSTALL_TOKEN ?? "",
    claudeCodeOAuthToken: env.CLAUDE_CODE_OAUTH_TOKEN ?? "",
    openrouter:
      runtime === "openrouter"
        ? {
            apiKey: env.OPENROUTER_API_KEY!,
            model: env.OPENROUTER_MODEL ?? "",
            maxCostUsd: positive(env, "OPENROUTER_MAX_COST_USD", 0.5),
            maxSteps: positive(env, "OPENROUTER_MAX_STEPS", 60),
          }
        : undefined,
  };
}
