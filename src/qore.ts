// Quantum Tip Jar — QoreChain helpers.
// Sources:
// - SDK quickstart: https://docs.qorechain.io/sdk/quickstart
//   (createClient defaults to testnet qorechain-diana; every native QOR transfer
//   must carry a hybrid secp256k1 + ML-DSA-87 signature; QOR has 10^6 uqor.)
// - QoreX integrations: https://docs.qorechain.io/developer-tools/qorex-integrations
//   (window.qorex.native is a Keplr-pattern provider; dApps send messages via
//   signAndBroadcast, QoreX adds the ML-DSA-87 layer and broadcasts; the
//   result carries `shield`, which is `shielded` when the committed tx carries
//   the hybrid layer. signDirect does NOT add the layer — never use it here.)
// - QoreX overview: https://docs.qorechain.io/qorex/overview
//   (every native QOR transfer is signed twice; the ML-DSA-87 key is registered
//   on chain with the first transaction, so a plain tip transfer IS the required
//   hybrid-signed transaction — no custom smart contract is needed.)

import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import {
  getQorexNative,
  hasCapability,
  qorexSignAndBroadcast,
  type QorexNativeProvider,
} from "@qorechain/qorex-types";

export const CHAIN_ID = "qorechain-diana";
export const CHAIN_NAME = "QoreChain Testnet (qorechain-diana)";
export const EVM_CHAIN_ID = 9800;
export const REST_PROXY_PATH = "/lcd"; // Vite proxies /lcd -> https://api-testnet.qore.host
export const EXPLORER_HOME = "https://explore.qore.network";
export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";
export const FEST_URL = "https://build.qorechain.io";

/** Tag put at the start of every tip memo so tips are recognisable on chain. */
export const TIP_MEMO_TAG = "Quantum Tip Jar";

export const MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

/** 1 QOR = 1,000,000 uqor on the native lane. */
export function qorToUqor(qor: string): string {
  const [whole = "0", frac = ""] = qor.trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 6) {
    throw new Error("Amount must be a number with at most 6 decimals.");
  }
  const padded = (frac + "000000").slice(0, 6);
  const base = BigInt(whole) * 1_000_000n + BigInt(padded || "0");
  if (base <= 0n) throw new Error("Amount must be greater than 0.");
  return base.toString();
}

export function uqorToQor(uqor: string | number | bigint): string {
  const v = BigInt(uqor);
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Strict-ish bech32 check for a native QoreChain address (qor1 + 38 chars). */
export function isValidQorAddress(address: string): boolean {
  return /^qor1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/.test(address.trim());
}

export function buildTipMemo(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  const memo = clean ? `${TIP_MEMO_TAG} — ${clean}` : TIP_MEMO_TAG;
  // qorexSignAndBroadcast allows a memo of up to 256 bytes.
  return new TextEncoder().encode(memo).length > 240
    ? memo.slice(0, 200)
    : memo;
}

/** REST URL that shows a committed tx as JSON (standard Cosmos LCD route). */
export function txRestUrl(txHash: string): string {
  return `https://api-testnet.qore.host/cosmos/tx/v1beta1/txs/${txHash}`;
}

// ---------------------------------------------------------------------------
// QoreX wallet
// ---------------------------------------------------------------------------

export function getNativeProvider(): QorexNativeProvider | null {
  return getQorexNative() ?? null;
}

export function isQorexInstalled(): boolean {
  return getNativeProvider() !== null;
}

export async function connectQorex(): Promise<string> {
  const native = getNativeProvider();
  if (!native) {
    throw new Error(
      "QoreX is not installed in this browser. Install the QoreX extension " +
        "(Chrome/Firefox) or open this page in the QoreX app's dApp browser, " +
        "switch it to Testnet, then try again.",
    );
  }
  if (!hasCapability(native, "signAndBroadcast")) {
    throw new Error(
      "This QoreX build does not expose signAndBroadcast. Update QoreX to the latest store version and try again.",
    );
  }
  // Throws "QoreX: unsupported chain" if the wallet is not on qorechain-diana.
  await native.enable(CHAIN_ID);
  const key = await native.getKey(CHAIN_ID);
  const address = (key as { bech32Address?: string }).bech32Address;
  if (!address || !isValidQorAddress(address)) {
    throw new Error("QoreX returned an unexpected address. Try reconnecting.");
  }
  return address;
}

export interface TipResult {
  txHash: string;
  code: number;
  height: number;
  shield: string;
}

/** Send a native QOR tip. QoreX signs it hybrid (secp256k1 + ML-DSA-87) and broadcasts. */
export async function sendTip(
  fromAddress: string,
  toAddress: string,
  amountQor: string,
  message: string,
): Promise<TipResult> {
  return sendBatchTip(fromAddress, [{ toAddress, amountQor }], message);
}

export interface BatchRecipient {
  toAddress: string;
  amountQor: string;
}

/**
 * Send one hybrid-signed transaction carrying a MsgSend per recipient, so a
 * single approval tips many people at once. Gas scales ~200k per transfer
 * (a single MsgSend used ~181k gas on testnet).
 */
export async function sendBatchTip(
  fromAddress: string,
  recipients: BatchRecipient[],
  message: string,
): Promise<TipResult> {
  if (recipients.length === 0) {
    throw new Error("Add at least one recipient.");
  }
  if (recipients.length > 10) {
    throw new Error("At most 10 recipients per send.");
  }
  const messages = recipients.map((r) => {
    const amountUqor = qorToUqor(r.amountQor);
    return {
      typeUrl: MSG_SEND_TYPE_URL,
      value: MsgSend.encode({
        fromAddress,
        toAddress: r.toAddress,
        amount: [{ denom: "uqor", amount: amountUqor }],
      }).finish(),
    };
  });
  const res = await qorexSignAndBroadcast({
    chainId: CHAIN_ID,
    messages,
    memo: buildTipMemo(message),
    gasLimit: 200000 * recipients.length,
  });
  return {
    txHash: res.txHash,
    code: res.code ?? -1,
    height: res.height ?? -1,
    shield: res.shield ?? "unknown",
  };
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface TipRecord {
  txHash: string;
  from: string;
  to: string;
  amountUqor: string;
  memo: string;
  timestamp: number; // ms since epoch
  shield?: string;
}

export interface TipperRow {
  address: string;
  totalUqor: bigint;
  tipCount: number;
  lastTipAt: number;
}

const LEDGER_KEY = "quantum-tip-jar:ledger:v1";

export function loadLedger(): TipRecord[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TipRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordTip(tip: TipRecord): TipRecord[] {
  const ledger = loadLedger();
  // A batch send shares one txHash across recipients, so dedupe on tx+to.
  if (!ledger.some((t) => t.txHash === tip.txHash && t.to === tip.to)) {
    ledger.unshift(tip);
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger.slice(0, 500)));
    } catch {
      // Storage full/blocked: the on-chain tx is still the source of truth.
    }
  }
  return ledger;
}

export function aggregateLeaderboard(tips: TipRecord[]): TipperRow[] {
  const bySender = new Map<string, TipperRow>();
  for (const tip of tips) {
    const row = bySender.get(tip.from) ?? {
      address: tip.from,
      totalUqor: 0n,
      tipCount: 0,
      lastTipAt: 0,
    };
    row.totalUqor += BigInt(tip.amountUqor);
    row.tipCount += 1;
    row.lastTipAt = Math.max(row.lastTipAt, tip.timestamp);
    bySender.set(tip.from, row);
  }
  return [...bySender.values()].sort((a, b) =>
    a.totalUqor === b.totalUqor
      ? b.lastTipAt - a.lastTipAt
      : b.totalUqor > a.totalUqor
        ? 1
        : -1,
  );
}

/**
 * Best-effort on-chain fetch of recent MsgSend transactions via the public
 * testnet REST gateway (through the Vite /lcd proxy in dev).
 *
 * VERIFIED LIMITATION (14 Nov 2026): every query form tried against
 * https://api-testnet.qore.host/cosmos/tx/v1beta1/txs returns
 * {"code":13,"message":"query cannot be empty"} — the public gateway does not
 * serve tx search by events. This function therefore returns [] today and the
 * leaderboard falls back to the app's own ledger (tips sent through this app),
 * each entry verifiable on chain via its tx link. If the gateway starts
 * serving tx search, results merge in automatically.
 */
export async function fetchOnChainTips(): Promise<TipRecord[]> {
  try {
    const url =
      `${REST_PROXY_PATH}/cosmos/tx/v1beta1/txs` +
      `?events=${encodeURIComponent("message.action='/cosmos.bank.v1beta1.MsgSend'")}` +
      `&pagination.limit=100&order_by=ORDER_BY_DESC`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      code?: number;
      tx_responses?: Array<{
        txhash: string;
        timestamp: string;
        tx?: {
          body?: {
            memo?: string;
            messages?: Array<{
              "@type"?: string;
              from_address?: string;
              to_address?: string;
              amount?: Array<{ denom: string; amount: string }>;
            }>;
          };
        };
      }>;
    };
    if (data.code !== undefined || !Array.isArray(data.tx_responses)) return [];
    const tips: TipRecord[] = [];
    for (const tx of data.tx_responses) {
      const memo = tx.tx?.body?.memo ?? "";
      for (const msg of tx.tx?.body?.messages ?? []) {
        if (msg["@type"] !== MSG_SEND_TYPE_URL) continue;
        if (!msg.from_address || !msg.to_address) continue;
        const uqor = msg.amount?.find((a) => a.denom === "uqor");
        if (!uqor) continue;
        tips.push({
          txHash: tx.txhash,
          from: msg.from_address,
          to: msg.to_address,
          amountUqor: uqor.amount,
          memo,
          timestamp: Date.parse(tx.timestamp) || Date.now(),
        });
      }
    }
    return tips;
  } catch {
    return [];
  }
}
