#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { authCommand } from "./commands/auth.js";
import { depositCommand } from "./commands/deposit.js";
import { withdrawCommand } from "./commands/withdraw.js";
import { balanceCommand } from "./commands/balance.js";

const program = new Command()
  .name("llmint")
  .description("LLMint CLI — deposit, withdraw, and manage your inference balance")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(authCommand);
program.addCommand(depositCommand);
program.addCommand(withdrawCommand);
program.addCommand(balanceCommand);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
