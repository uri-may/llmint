import { Command } from "commander";
import { loadConfig } from "../lib/config.js";
import { getAccount } from "../lib/wallet.js";
import { createVaultClient } from "../lib/contract.js";
import { parseUsdc, formatUsdcTrimmed } from "../lib/format.js";

export const depositCommand = new Command("deposit")
  .description("Deposit USDC to the vault")
  .argument("<amount>", "Amount in USDC (e.g. 50, 10.5)")
  .action(async (amountStr: string) => {
    const config = await loadConfig();
    const account = getAccount();
    const vault = createVaultClient(config);
    const amount = parseUsdc(amountStr);

    console.log("Approving USDC spend...");
    await vault.approveUsdc(amount);

    console.log(`Depositing ${amountStr} USDC...`);
    await vault.deposit(amount);

    const balance = await vault.balanceOf(account.address);
    console.log(`Balance: ${formatUsdcTrimmed(balance)}`);
  });
