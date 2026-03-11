import { serve } from "@hono/node-server";

import { loadConfig } from "./config.js";
import { createChainClient } from "./settlement/chain.js";
import { createMockArweaveStore } from "./settlement/arweave.js";
import { createServer } from "./server.js";

const config = loadConfig();
const chainClient = createChainClient(config);
const arweaveStore = createMockArweaveStore();

const { app, settleAll } = createServer({ config, chainClient, arweaveStore });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`llmint-platform listening on port ${info.port}`);
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, settling active sessions...`);

  try {
    await settleAll();
    console.log("All sessions settled");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Settlement error during shutdown: ${msg}`);
  }

  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
