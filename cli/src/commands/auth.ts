import { Command } from "commander";
import { getAccount } from "../lib/wallet.js";
import { signJwt, decodeJwt } from "../lib/jwt.js";

export const authCommand = new Command("auth")
  .description("Generate a JWT signed with your wallet key")
  .option(
    "--expires <seconds>",
    "Token expiry in seconds",
    String(365 * 24 * 60 * 60),
  )
  .action(async (opts: { expires: string }) => {
    const account = getAccount();
    const expiresIn = parseInt(opts.expires, 10);

    console.log("Signing auth message...");
    const token = await signJwt(account, expiresIn);
    const { payload } = decodeJwt(token);

    const expiryDate = new Date(payload.exp * 1000);

    console.log(`API Key: ${token}`);
    console.log(`Wallet: ${account.address}`);
    console.log(`Expires: ${expiryDate.toISOString().split("T")[0]}`);
  });
