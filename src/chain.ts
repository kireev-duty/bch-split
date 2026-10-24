import { ElectrumClient } from "@electrum-cash/network";
import {
  binToHex,
  cashAddressToLockingBytecode,
  decodeAuthenticationInstructions,
  encodeDataPush,
  flattenBinArray,
  hexToBin,
  utf8ToBin,
  binToUtf8,
} from "@bitauth/libauth";

const SERVERS = ["bch.imaginary.cash", "electroncash.de", "fulcrum.greyh.at"];
export const MEMO_TAG = "split";
export const SATS_PER_BCH = 100_000_000;

let clientPromise: Promise<ElectrumClient<any>> | null = null;

async function connectFirstAvailable() {
  let lastError: unknown;
  for (const host of SERVERS) {
    try {
      const client = new ElectrumClient("bch-split", "1.4.1", host);
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No Electrum server reachable");
}

export function electrum() {
  clientPromise ??= connectFirstAvailable().catch((error) => {
    clientPromise = null;
    throw error;
  });
  return clientPromise;
}

async function request<T>(method: string, ...params: unknown[]): Promise<T> {
  const client = await electrum();
  const result = await client.request(method, ...(params as any[]));
  if (result instanceof Error) throw result;
  return result as T;
}

export interface Utxo {
  tx_hash: string;
  tx_pos: number;
  value: number;
  height: number;
  token_data?: unknown;
}

export const listUnspent = (address: string) =>
  request<Utxo[]>("blockchain.address.listunspent", address);

export const getHistory = (address: string) =>
  request<{ tx_hash: string; height: number }[]>("blockchain.address.get_history", address);

interface VerboseTx {
  txid: string;
  time?: number;
  confirmations?: number;
  vout: { value: number; scriptPubKey: { hex: string; addresses?: string[] } }[];
}

const txCache = new Map<string, VerboseTx>();

async function getVerboseTx(txid: string) {
  const cached = txCache.get(txid);
  if (cached?.confirmations) return cached;
  const tx = await request<VerboseTx>("blockchain.transaction.get", txid, true);
  txCache.set(txid, tx);
  return tx;
}

export function lockingBytecode(address: string) {
  const decoded = cashAddressToLockingBytecode(address);
  if (typeof decoded === "string") throw new Error(decoded);
  return decoded.bytecode;
}

export function memoBytecode(billId: string, name: string) {
  return flattenBinArray([
    Uint8Array.of(0x6a),
    encodeDataPush(utf8ToBin(MEMO_TAG)),
    encodeDataPush(utf8ToBin(billId)),
    encodeDataPush(utf8ToBin(name.slice(0, 60))),
  ]);
}

export function parseMemo(hex: string): { billId: string; name: string } | null {
  if (!hex.startsWith("6a")) return null;
  const pushes = decodeAuthenticationInstructions(hexToBin(hex).slice(1)).map((ins) =>
    "data" in ins ? binToUtf8(ins.data) : null,
  );
  if (pushes[0] !== MEMO_TAG || !pushes[1] || pushes[2] == null) return null;
  return { billId: pushes[1], name: pushes[2] };
}

export interface Payment {
  txid: string;
  name: string;
  sats: number;
  confirmed: boolean;
}

export async function findPayments(payTo: string, billId: string): Promise<Payment[]> {
  const targetHex = binToHex(lockingBytecode(payTo));
  const history = (await getHistory(payTo)).slice(-60);
  const txs = await Promise.all(history.map((h) => getVerboseTx(h.tx_hash)));
  const payments: Payment[] = [];
  for (const tx of txs) {
    const memo = tx.vout.map((o) => parseMemo(o.scriptPubKey.hex)).find(Boolean);
    if (!memo || memo.billId !== billId) continue;
    const sats = tx.vout
      .filter((o) => o.scriptPubKey.hex === targetHex)
      .reduce((sum, o) => sum + Math.round(o.value * SATS_PER_BCH), 0);
    payments.push({ txid: tx.txid, name: memo.name, sats, confirmed: (tx.confirmations ?? 0) > 0 });
  }
  return payments;
}

export async function watchAddress(address: string, onChange: () => void) {
  const client = await electrum();
  const handler = (data: any) => {
    if (data?.method === "blockchain.address.subscribe" && data.params?.[0] === address) onChange();
  };
  client.on("notification", handler);
  await client.subscribe("blockchain.address.subscribe", address);
  return () => {
    client.off("notification", handler);
    client.unsubscribe("blockchain.address.subscribe", address).catch(() => {});
  };
}

let priceCache: { usd: number; at: number } | null = null;

export async function bchUsdPrice(): Promise<number> {
  if (priceCache && Date.now() - priceCache.at < 120_000) return priceCache.usd;
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd",
  );
  const usd = (await response.json())["bitcoin-cash"].usd as number;
  priceCache = { usd, at: Date.now() };
  return usd;
}
