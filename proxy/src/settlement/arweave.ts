import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export interface ArweaveStore {
  upload(leaves: Uint8Array[]): Promise<string>;
  fetch(txId: string): Promise<Uint8Array[]>;
}

export function createMockArweaveStore(): ArweaveStore {
  const baseDir = join(homedir(), ".llmint-proxy", "arweave");

  return {
    async upload(leaves: Uint8Array[]): Promise<string> {
      await mkdir(baseDir, { recursive: true });
      const hexLeaves = leaves.map((l) => bytesToHex(l));
      const content = JSON.stringify(hexLeaves);
      const txId = bytesToHex(
        sha256(new TextEncoder().encode(content)),
      );
      await writeFile(join(baseDir, `${txId}.json`), content, "utf-8");
      return txId;
    },

    async fetch(txId: string): Promise<Uint8Array[]> {
      const content = await readFile(
        join(baseDir, `${txId}.json`),
        "utf-8",
      );
      const hexLeaves: string[] = JSON.parse(content) as string[];
      return hexLeaves.map((h) => hexToBytes(h));
    },
  };
}
