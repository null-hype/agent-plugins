import http from "node:http";
import { LinearClient } from "@linear/sdk";
import { LinearWebhookClient } from "@linear/sdk/webhooks";
import type { Config } from "./config.ts";
import { authorizeUrl, exchangeCode } from "./oauth.ts";
import { handleAgentSessionEvent, handleIssueEvent } from "./session.ts";

export function createServer(cfg: Config): http.Server {
  const webhookClient = new LinearWebhookClient(cfg.linearWebhookSecret);
  const webhookHandler = webhookClient.createHandler();

  // installToken can change after a fresh /oauth/callback run without a
  // restart, so the LinearClient used by the webhook handler is rebuilt
  // lazily from whatever the current value is rather than captured once.
  let installToken = cfg.linearInstallToken;

  // Both handlers below THROW (rather than log-and-return) when no install
  // token is configured. LinearWebhookClient's createHandler() awaits every
  // registered handler for the event type (`await Promise.all(...)`) before
  // writing its response, so a synchronous throw here is caught by its own
  // top-level try/catch and turned into a 500 instead of the 200 "OK" a
  // normal (fire-and-forget) return would produce. That's the whole fix for
  // JIN-36: a signed, structurally-valid AgentSessionEvent that this process
  // cannot actually act on now shows up as a failed delivery in Linear's own
  // webhook log, instead of looking identical to a working turn. See also
  // GET /healthz below, which reports the same install-token gap without
  // requiring a signed payload to probe it.
  webhookHandler.on("AgentSessionEvent", (payload) => {
    if (!installToken) {
      console.error("AgentSessionEvent received before an installation token was configured");
      throw new Error("no installation token configured");
    }
    const linear = new LinearClient({ accessToken: installToken });
    // Deliberately not awaited: handleAgentSessionEvent posts its required
    // `thought` activity first and only then does the slow `claude` work.
    void handleAgentSessionEvent(payload, linear, cfg.claudeCodeOAuthToken).catch((err) => {
      console.error("AgentSessionEvent handling failed", err);
    });
  });

  webhookHandler.on("Issue", (payload) => {
    if (!installToken) {
      console.error("Issue event received before an installation token was configured");
      throw new Error("no installation token configured");
    }
    const linear = new LinearClient({ accessToken: installToken });
    void handleIssueEvent(payload, linear, cfg.claudeCodeOAuthToken).catch((err) => {
      console.error("Issue event handling failed", err);
    });
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://internal");

    if (req.method === "POST" && url.pathname === "/webhooks/linear") {
      await webhookHandler(req, res);
      return;
    }

    // Unauthenticated, unsigned health probe: reports whether this process
    // structurally *can* serve a signed AgentSessionEvent right now (i.e.
    // whether an install token is loaded), without needing a valid HMAC
    // signature to find out. check-linear-agent-webhook.sh and
    // check-linear-agent-webhook-live.sh only prove DNS/TLS/tunnel/
    // process-alive/HMAC-secret-match -- their sample payload (action
    // "created", no promptContext) short-circuits in buildPrompt() before
    // ever reaching the installToken check, so a green check from those
    // scripts says nothing about whether this endpoint can actually do
    // anything. This does.
    if (req.method === "GET" && url.pathname === "/healthz") {
      const body = JSON.stringify({ installTokenConfigured: Boolean(installToken) });
      res.writeHead(installToken ? 200 : 503, { "Content-Type": "application/json" });
      res.end(body);
      return;
    }

    if (req.method === "GET" && url.pathname === "/oauth/authorize") {
      res.writeHead(302, { Location: authorizeUrl(cfg) });
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/oauth/callback") {
      const code = url.searchParams.get("code");
      if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("missing code");
        return;
      }
      try {
        const token = await exchangeCode(cfg, code);
        installToken = token.access_token;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(
          "Installed. Persist this token so it survives a restart:\n\n" +
            `pass-cli item update --item-title agent.tidelands.dev --field LINEAR_INSTALL_TOKEN=${token.access_token}\n`,
        );
      } catch (err) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });
}
