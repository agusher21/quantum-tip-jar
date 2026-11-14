import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient, type QoreChainClient } from "@qorechain/sdk";

import {
  aggregateLeaderboard,
  buildTipMemo,
  CHAIN_NAME,
  connectQorex,
  EXPLORER_HOME,
  FAUCET_URL,
  FEST_URL,
  fetchOnChainTips,
  isQorexInstalled,
  isValidQorAddress,
  loadLedger,
  qorToUqor,
  recordTip,
  REST_PROXY_PATH,
  sendTip,
  TIP_MEMO_TAG,
  txRestUrl,
  uqorToQor,
  type TipRecord,
  type TipResult,
} from "./qore.js";

// REST goes through the Vite dev/preview proxy (/lcd -> api-testnet.qore.host)
// because the public REST API sends no CORS headers.
const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? REST_PROXY_PATH;

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "1.25rem",
  marginTop: "1rem",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: "1rem",
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.6rem 1.2rem",
  border: "none",
  borderRadius: 8,
  background: "#6d28d9",
  color: "#fff",
  fontSize: "1rem",
  cursor: "pointer",
};

function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

export function App(): JSX.Element {
  const client: QoreChainClient = useMemo(
    () =>
      createClient({
        network: "testnet",
        endpoints: { rest: REST_URL },
      }),
    [],
  );

  const [address, setAddress] = useState<string | null>(null);
  const [balanceUqor, setBalanceUqor] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [tips, setTips] = useState<TipRecord[]>(() => loadLedger());
  const [onChainNote, setOnChainNote] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastTip, setLastTip] = useState<TipResult | null>(null);
  const [mockOn, setMockOn] = useState(false);

  // Dev-only test aid: ?mock=1 installs the official QoreX test double
  // (@qorechain/qorex-wallet-mock, public test phrase, testnet only) so the
  // connect flow can be tried without the extension. It holds no real funds
  // and must never be funded. Never enabled in production.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mock") !== "1") return;
    let cancelled = false;
    void import("@qorechain/qorex-wallet-mock")
      .then(({ createQorexMock }) => {
        if (cancelled) return;
        createQorexMock({ profile: "current" }).install(window);
        setMockOn(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    try {
      const res = await client.rest.getAllBalances(address);
      const qor = (res.balances as Array<{ denom: string; amount: string }>).find(
        (b) => b.denom === "uqor",
      );
      setBalanceUqor(qor ? qor.amount : "0");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [address, client]);

  // Best-effort merge of on-chain tips into the leaderboard.
  useEffect(() => {
    let cancelled = false;
    void fetchOnChainTips().then((found) => {
      if (cancelled) return;
      if (found.length > 0) {
        setTips((prev) => {
          const seen = new Set(prev.map((t) => t.txHash));
          const merged = [...prev];
          for (const tip of found) {
            if (!seen.has(tip.txHash)) merged.push(tip);
          }
          return merged.sort((a, b) => b.timestamp - a.timestamp);
        });
        setOnChainNote(
          `${found.length} tip(s) read from the testnet chain.`,
        );
      } else {
        setOnChainNote(
          "The public testnet API does not serve tx search yet, so this board " +
            "lists tips sent through this app — every entry is verifiable on " +
            "chain via its tx link.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshBalance();
  }, [refreshBalance]);

  async function handleConnect(): Promise<void> {
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const addr = await connectQorex();
      setAddress(addr);
      setStatus(`Connected to QoreX on ${CHAIN_NAME}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleDisconnect(): void {
    setAddress(null);
    setBalanceUqor(null);
    setLastTip(null);
    setStatus("Disconnected. Your tips stay on chain and in the leaderboard.");
  }

  async function handleSendTip(): Promise<void> {
    setError(null);
    setStatus(null);
    setLastTip(null);
    if (!address) {
      setError("Connect QoreX first.");
      return;
    }
    const to = recipient.trim();
    if (!isValidQorAddress(to)) {
      setError("Recipient must be a valid qor1… address.");
      return;
    }
    let amountUqor: string;
    try {
      amountUqor = qorToUqor(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (balanceUqor !== null && BigInt(amountUqor) > BigInt(balanceUqor)) {
      setError(
        `Amount (${amount} QOR) is more than your balance (${uqorToQor(balanceUqor)} QOR). Top up from the faucet first.`,
      );
      return;
    }
    setBusy(true);
    setStatus("Waiting for your approval in QoreX…");
    try {
      const res = await sendTip(address, to, amount, message);
      if (res.code !== 0) {
        setError(`Transaction failed on chain (code ${res.code}). Tx: ${res.txHash}`);
        return;
      }
      const record: TipRecord = {
        txHash: res.txHash,
        from: address,
        to,
        amountUqor,
        memo: buildTipMemo(message),
        timestamp: Date.now(),
        shield: res.shield,
      };
      setTips(recordTip(record));
      setLastTip(res);
      if (res.shield === "shielded") {
        setStatus(
          "Tip sent and hybrid-signed (secp256k1 + ML-DSA-87). Shield: shielded.",
        );
      } else {
        setStatus(
          `Tip sent (tx ${res.txHash}). Shield reported as "${res.shield}" — ` +
            "check the tx on chain before counting it as hybrid-signed.",
        );
      }
      setAmount("");
      setMessage("");
      void refreshBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const leaderboard = useMemo(() => aggregateLeaderboard(tips), [tips]);
  const recentTips = useMemo(
    () => [...tips].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [tips],
  );

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 760,
        margin: "2rem auto",
        padding: "0 1rem",
        lineHeight: 1.5,
        color: "#111827",
      }}
    >
      <header>
        <h1 style={{ marginBottom: 0 }}>🫙 Quantum Tip Jar</h1>
        <p style={{ color: "#555", marginTop: "0.25rem" }}>
          Send a testnet QOR tip to any <code>qor1…</code> address. Every tip
          is a hybrid-signed transaction (secp256k1 + ML-DSA-87) on{" "}
          <code>{CHAIN_NAME}</code>.
        </p>
        <p style={{ color: "#555", fontSize: "0.9rem" }}>
          Built for the QoreChain Developer Fest — Quantum Pass. Testnet only;
          QOR here has no real value.
          {mockOn && (
            <span style={{ color: "#b45309" }}>
              {" "}
              [dev mock wallet active — test phrase, never fund it]
            </span>
          )}
        </p>
      </header>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Wallet</h2>
        {address ? (
          <div>
            <p>
              Connected: <code>{shortAddress(address)}</code>
            </p>
            <p>
              Balance:{" "}
              <strong>
                {balanceUqor === null
                  ? "loading…"
                  : `${uqorToQor(balanceUqor)} QOR`}
              </strong>{" "}
              <button
                onClick={() => void refreshBalance()}
                disabled={busy}
                style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
              >
                Refresh
              </button>{" "}
              <button
                onClick={handleDisconnect}
                style={{ ...buttonStyle, background: "#e5e7eb", color: "#111827" }}
              >
                Disconnect
              </button>
            </p>
            <p style={{ fontSize: "0.9rem", color: "#555" }}>
              Need test QOR? Claim 100 QOR / 24h at the{" "}
              <a href={FAUCET_URL} target="_blank" rel="noreferrer">
                QoreChain faucet
              </a>{" "}
              (dashboard sign-in, paste your <code>qor1…</code> address).
            </p>
          </div>
        ) : (
          <div>
            <p style={{ color: "#555" }}>
              Connect QoreX (switched to Testnet) to send a tip. No wallet is
              needed to browse the leaderboard.
            </p>
            <button onClick={() => void handleConnect()} disabled={busy} style={buttonStyle}>
              {busy ? "Connecting…" : "Connect QoreX"}
            </button>
            {!isQorexInstalled() && (
              <p style={{ fontSize: "0.9rem", color: "#b45309" }}>
                QoreX was not detected in this browser. Install the QoreX
                extension or open this page in the QoreX app&apos;s dApp
                browser. (Add <code>?mock=1</code> to the URL to try the dev
                test wallet instead.)
              </p>
            )}
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Send a tip</h2>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Recipient (<code>qor1…</code>)
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="qor1…"
            style={{ ...inputStyle, marginTop: "0.25rem" }}
            aria-label="Recipient address"
          />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Amount (QOR)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 1.5"
            inputMode="decimal"
            style={{ ...inputStyle, marginTop: "0.25rem" }}
            aria-label="Amount in QOR"
          />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Message (optional, goes in the tx memo)
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Thanks for the great work!"
            maxLength={200}
            style={{ ...inputStyle, marginTop: "0.25rem" }}
            aria-label="Tip message"
          />
        </label>
        <button
          onClick={() => void handleSendTip()}
          disabled={busy || !address}
          style={{ ...buttonStyle, opacity: address ? 1 : 0.6 }}
        >
          {busy ? "Working…" : "Send tip (hybrid-signed)"}
        </button>
        {!address && (
          <p style={{ fontSize: "0.9rem", color: "#555" }}>
            Connect QoreX above to enable tipping.
          </p>
        )}
        <p style={{ fontSize: "0.9rem", color: "#555" }}>
          QoreX shows the decoded transfer and the fee before you approve it.
          The wallet adds the ML-DSA-87 layer and registers your post-quantum
          key on your first transaction. Memo tag:{" "}
          <code>{TIP_MEMO_TAG}</code>.
        </p>
      </section>

      {status && (
        <p style={{ color: "#065f46", marginTop: "1rem" }} role="status">
          {status}
        </p>
      )}
      {error && (
        <p style={{ color: "#b00020", marginTop: "1rem" }} role="alert">
          {error}
        </p>
      )}
      {lastTip && (
        <p style={{ marginTop: "0.5rem" }}>
          Tx:{" "}
          <a href={txRestUrl(lastTip.txHash)} target="_blank" rel="noreferrer">
            <code>{lastTip.txHash}</code>
          </a>{" "}
          (height {lastTip.height}, shield {lastTip.shield})
        </p>
      )}

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>🏆 Top tippers</h2>
        {onChainNote && (
          <p style={{ fontSize: "0.9rem", color: "#555" }}>{onChainNote}</p>
        )}
        {leaderboard.length === 0 ? (
          <p style={{ color: "#555" }}>
            No tips yet — be the first to tip and take the top spot.
          </p>
        ) : (
          <ol style={{ paddingLeft: "1.5rem" }}>
            {leaderboard.map((row, i) => (
              <li key={row.address} style={{ marginBottom: "0.5rem" }}>
                <code>{shortAddress(row.address)}</code> —{" "}
                <strong>{uqorToQor(row.totalUqor)} QOR</strong> in{" "}
                {row.tipCount} tip{row.tipCount > 1 ? "s" : ""}
                {i === 0 && " 👑"}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Recent tips</h2>
        {recentTips.length === 0 ? (
          <p style={{ color: "#555" }}>Nothing here yet.</p>
        ) : (
          <ul style={{ paddingLeft: "1.25rem" }}>
            {recentTips.map((tip) => (
              <li key={tip.txHash} style={{ marginBottom: "0.5rem" }}>
                <code>{shortAddress(tip.from)}</code> →{" "}
                <code>{shortAddress(tip.to)}</code>:{" "}
                <strong>{uqorToQor(tip.amountUqor)} QOR</strong>
                {tip.memo.replace(TIP_MEMO_TAG, "").trim() &&
                  ` — “${tip.memo.replace(`${TIP_MEMO_TAG} — `, "")}”`}{" "}
                <a href={txRestUrl(tip.txHash)} target="_blank" rel="noreferrer">
                  tx
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer style={{ marginTop: "1.5rem", fontSize: "0.9rem", color: "#555" }}>
        <p>
          How it works: the app connects to QoreX on{" "}
          <code>{CHAIN_NAME}</code>, reads balances over the QoreChain REST
          API, and sends native <code>MsgSend</code> transfers through{" "}
          <code>qorexSignAndBroadcast</code>. QoreX signs every transfer twice
          (secp256k1 + ML-DSA-87) — that hybrid signature is the
          post-quantum part. No smart contract, no server, no custody: tips go
          straight from your wallet to the recipient.
        </p>
        <p>
          <a href={FEST_URL} target="_blank" rel="noreferrer">
            QoreChain Developer Fest
          </a>{" "}
          ·{" "}
          <a href={EXPLORER_HOME} target="_blank" rel="noreferrer">
            Explorer
          </a>{" "}
          ·{" "}
          <a href={FAUCET_URL} target="_blank" rel="noreferrer">
            Faucet
          </a>
        </p>
      </footer>
    </main>
  );
}
