const USDC_DECIMALS = 6;
const USDC_FACTOR = 10n ** BigInt(USDC_DECIMALS);

export function parseUsdc(amount: string): bigint {
  const parts = amount.split(".");
  const whole = parts[0] ?? "0";
  const frac = (parts[1] ?? "").padEnd(USDC_DECIMALS, "0").slice(0, USDC_DECIMALS);
  return BigInt(whole) * USDC_FACTOR + BigInt(frac);
}

export function formatUsdc(amount: bigint): string {
  const whole = amount / USDC_FACTOR;
  const frac = amount % USDC_FACTOR;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0");
  return `$${whole}.${fracStr}`;
}

export function formatUsdcTrimmed(amount: bigint): string {
  const whole = amount / USDC_FACTOR;
  const frac = amount % USDC_FACTOR;
  if (frac === 0n) {
    return `$${whole}.00`;
  }
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `$${whole}.${fracStr}`;
}
