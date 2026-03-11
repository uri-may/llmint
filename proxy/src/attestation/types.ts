export interface Attestation {
  requestHash: string;
  responseHash: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: string;
  nonce: number;
  callIndex: number;
  chainHash: string;
  timestamp: number;
}
