import { loadConfig } from "./config.ts";
import { createServer } from "./server.ts";

const cfg = loadConfig();
const server = createServer(cfg);
server.listen(cfg.port, () => {
  console.log(`linear-agent listening on :${cfg.port}`);
});
