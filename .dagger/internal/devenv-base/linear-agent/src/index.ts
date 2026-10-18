import { loadConfig } from "./config.ts";
import { mintAppToken } from "./oauth.ts";
import { createServer } from "./server.ts";

const cfg = loadConfig();
if (!cfg.linearInstallToken) {
  cfg.linearInstallToken = await mintAppToken(cfg);
  console.log("minted Linear app token via client_credentials");
}
const server = createServer(cfg);
server.listen(cfg.port, () => {
  console.log(`linear-agent listening on :${cfg.port}`);
});
