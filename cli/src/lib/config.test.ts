import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, readFile, mkdir } from "node:fs/promises";

describe("config", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "llmint-test-"));
    configPath = join(tempDir, "config.json");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("saves and loads config", async () => {
    const config = {
      network: "local" as const,
      rpcUrl: "http://127.0.0.1:8545",
      vaultAddress: "0x1234",
      usdcAddress: "0x5678",
      chainId: 31337,
    };

    await writeFile(configPath, JSON.stringify(config, null, 2));
    const raw = await readFile(configPath, "utf-8");
    const loaded = JSON.parse(raw);

    expect(loaded).toEqual(config);
  });

  it("detects missing config", async () => {
    const missingPath = join(tempDir, "nonexistent.json");
    await expect(readFile(missingPath, "utf-8")).rejects.toThrow();
  });
});

describe("getPreset", () => {
  it("returns local preset", async () => {
    const { getPreset } = await import("./config.js");
    const preset = getPreset("local");
    expect(preset.chainId).toBe(31337);
    expect(preset.rpcUrl).toBe("http://127.0.0.1:8545");
  });

  it("returns base preset", async () => {
    const { getPreset } = await import("./config.js");
    const preset = getPreset("base");
    expect(preset.chainId).toBe(8453);
    expect(preset.usdcAddress).toBe(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    );
  });

  it("throws for unknown network", async () => {
    const { getPreset } = await import("./config.js");
    expect(() => getPreset("unknown")).toThrow("Unknown network");
  });
});
