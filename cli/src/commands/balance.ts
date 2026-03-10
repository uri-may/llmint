import { Command } from "commander";
import { loadConfig } from "../lib/config.js";
import { getAccount } from "../lib/wallet.js";
import { createVaultClient } from "../lib/contract.js";
import { formatUsdcTrimmed } from "../lib/format.js";

export const balanceCommand = new Command("balance")
  .description("Show vault balance (total, locked, available)")
  .action(async () => {
    const config = await loadConfig();
    const account = getAccount();
    const vault = createVaultClient(config);

    const [total, locked, available] = await Promise.all([
      vault.balanceOf(account.address),
      vault.lockedOf(account.address),
      vault.availableOf(account.address),
    ]);

    console.log(
      `Balance: ${formatUsdcTrimmed(total)} | Locked: ${formatUsdcTrimmed(locked)} | Available: ${formatUsdcTrimmed(available)}`,
    );
  });
