import { binToHex, encodeCashAddress, encodeTransaction, hash160, hexToBin } from "@bitauth/libauth";
import type { DappConnectionManager } from "@wizardconnect/dapp";
import { getHistory, listUnspent, lockingBytecode, memoBytecode, type Utxo } from "./chain";

interface TxInput {
  outpointTransactionHash: Uint8Array;
  outpointIndex: number;
  unlockingBytecode: Uint8Array;
  sequenceNumber: number;
}

interface TxOutput {
  valueSatoshis: bigint;
  lockingBytecode: Uint8Array;
}

const transactionToHex = (inputs: TxInput[], outputs: TxOutput[]) =>
  binToHex(encodeTransaction({ version: 2, locktime: 0, inputs, outputs }));

const sourceOutputToRelay = (input: TxInput & TxOutput) => ({
  outpointTransactionHash: binToHex(input.outpointTransactionHash),
  outpointIndex: input.outpointIndex,
  unlockingBytecode: binToHex(input.unlockingBytecode),
  sequenceNumber: input.sequenceNumber,
  valueSatoshis: `<bigint: ${input.valueSatoshis}n>`,
  lockingBytecode: binToHex(input.lockingBytecode),
});

const RECEIVE = 0;
const CHANGE = 1;
const SCAN_DEPTH = 10;
const DUST = 546;
const FEE_PER_BYTE = 1.1;

type PathName = "receive" | "change";

interface WalletAddress {
  path: PathName;
  index: number;
  address: string;
}

interface Coin extends WalletAddress {
  utxo: Utxo;
}

function addressAt(manager: DappConnectionManager, child: number, index: number) {
  const pubkey = manager.getPubkey(child, BigInt(index));
  if (!pubkey) return null;
  return encodeCashAddress({ prefix: "bitcoincash", type: "p2pkh", payload: hash160(pubkey) }).address;
}

function walletAddresses(manager: DappConnectionManager): WalletAddress[] {
  const out: WalletAddress[] = [];
  for (const [child, path] of [[RECEIVE, "receive"], [CHANGE, "change"]] as const) {
    for (let index = 0; index < SCAN_DEPTH; index++) {
      const address = addressAt(manager, child, index);
      if (address) out.push({ path, index, address });
    }
  }
  return out;
}

export function primaryAddress(manager: DappConnectionManager) {
  return addressAt(manager, RECEIVE, 0);
}

async function scanWallet(manager: DappConnectionManager) {
  const addresses = walletAddresses(manager);
  if (!addresses.length) throw new Error("Wallet did not share any public keys");
  const [utxoSets, histories] = await Promise.all([
    Promise.all(addresses.map((a) => listUnspent(a.address))),
    Promise.all(addresses.map((a) => getHistory(a.address))),
  ]);
  const coins: Coin[] = addresses.flatMap((a, i) =>
    utxoSets[i].filter((u) => !u.token_data).map((utxo) => ({ ...a, utxo })),
  );
  const change =
    addresses.find((a, i) => a.path === "change" && histories[i].length === 0) ??
    addresses.find((a) => a.path === "receive")!;
  return { coins, change };
}

export async function walletBalance(manager: DappConnectionManager) {
  const { coins } = await scanWallet(manager);
  return coins.reduce((sum, c) => sum + c.utxo.value, 0);
}

const estimateSize = (inputs: number, outputs: number, memoLength: number) =>
  10 + inputs * 148 + outputs * 34 + memoLength + 9;

export async function payShare(
  manager: DappConnectionManager,
  options: { to: string; sats: number; billId: string; name: string; prompt: string },
) {
  if (options.sats < DUST) throw new Error(`Amount is below the ${DUST} sat dust limit`);
  const { coins, change } = await scanWallet(manager);
  const memo = memoBytecode(options.billId, options.name);

  const selected: Coin[] = [];
  let inputTotal = 0;
  let fee = 0;
  for (const coin of [...coins].sort((a, b) => b.utxo.value - a.utxo.value)) {
    selected.push(coin);
    inputTotal += coin.utxo.value;
    fee = Math.ceil(estimateSize(selected.length, 2, memo.length) * FEE_PER_BYTE);
    if (inputTotal >= options.sats + fee) break;
  }
  if (inputTotal < options.sats + fee) {
    throw new Error(
      `Not enough BCH: need ${options.sats + fee} sats, wallet has ${inputTotal} sats spendable`,
    );
  }

  const outputs = [
    { valueSatoshis: BigInt(options.sats), lockingBytecode: lockingBytecode(options.to) },
    { valueSatoshis: 0n, lockingBytecode: memo },
  ];
  const changeValue = inputTotal - options.sats - fee;
  if (changeValue >= DUST) {
    outputs.push({ valueSatoshis: BigInt(changeValue), lockingBytecode: lockingBytecode(change.address) });
  }

  const inputs = selected.map((c) => ({
    outpointTransactionHash: hexToBin(c.utxo.tx_hash),
    outpointIndex: c.utxo.tx_pos,
    unlockingBytecode: new Uint8Array(),
    sequenceNumber: 0xffffffff,
  }));
  const sourceOutputs = selected.map((c, i) =>
    sourceOutputToRelay({
      ...inputs[i],
      valueSatoshis: BigInt(c.utxo.value),
      lockingBytecode: lockingBytecode(c.address),
    }),
  );

  const response = await manager.signTransaction({
    transaction: {
      transaction: transactionToHex(inputs, outputs),
      // The relay sends plain JSON, so source outputs travel hex/bigint-encoded.
      sourceOutputs: sourceOutputs as any,
      broadcast: true,
      userPrompt: options.prompt,
    },
    inputPaths: selected.map((c, i) => [i, c.path, c.index] as [number, string, number]),
  });
  if (response.error) throw new Error(response.error);
  return response.signedTransaction;
}
