import { Command } from "commander";
import { loadConfig } from "../lib/config.js";
import { getAccount } from "../lib/wallet.js";
import { createVaultClient } from "../lib/contract.js";
import { parseUsdc, formatUsdcTrimmed } from "../lib/format.js";

export const withdrawCommand = new Command("withdraw")
  .description("Withdraw USDC from the vault")
  .argument("<amount>", "Amount in USDC (e.g. 10, 5.5)")
  .action(async (amountStr: string) => {
    const config = await loadConfig();
    const account = getAccount();
    const vault = createVaultClient(config);
    const amount = parseUsdc(amountStr);

    console.log(`Withdrawing ${amountStr} USDC...`);
    await vault.withdraw(amount);

    const balance = await vault.balanceOf(account.address);
    console.log(`Balance: ${formatUsdcTrimmed(balance)}`);
  });
