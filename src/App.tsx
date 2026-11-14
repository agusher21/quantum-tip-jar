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
  sendBatchTip,
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
  border: "1px solid #e9e5f5",
  borderRadius: 16,
  padding: "1.25rem",
  marginTop: "1rem",
  boxShadow: "0 4px 24px rgba(109, 40, 217, 0.08)",
};

const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "0.2rem 0.65rem",
  borderRadius: 999,
  background: "rgba(237, 233, 254, 0.16)",
  color: "#ede9fe",
  fontSize: "0.8rem",
  fontWeight: 600,
  marginRight: "0.4rem",
  border: "1px solid rgba(237, 233, 254, 0.35)",
};

const linkLight: React.CSSProperties = { color: "#c4b5fd" };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: "1rem",
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.65rem 1.4rem",
  border: "none",
  borderRadius: 10,
  background: "linear-gradient(135deg, #7c3aed, #6d28d9)",
  color: "#fff",
  fontSize: "1rem",
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 2px 12px rgba(109, 40, 217, 0.35)",
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
  const [recipientsText, setRecipientsText] = useState("");
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

  /** Recipient list: one qor1… address per line, deduped, max 10. */
  const recipientList = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const line of recipientsText.split("\n")) {
      const addr = line.trim();
      if (addr && !seen.has(addr)) {
        seen.add(addr);
        list.push(addr);
      }
    }
    return list;
  }, [recipientsText]);

  /** Total QOR for this send (same amount per person). */
  const totalUqor = useMemo(() => {
    try {
      if (recipientList.length === 0) return null;
      return (BigInt(qorToUqor(amount)) * BigInt(recipientList.length)).toString();
    } catch {
      return null;
    }
  }, [amount, recipientList]);

  async function handleSendTip(): Promise<void> {
    setError(null);
    setStatus(null);
    setLastTip(null);
    if (!address) {
      setError("Connect QoreX first.");
      return;
    }
    if (recipientList.length === 0) {
      setError("Add at least one recipient address.");
      return;
    }
    if (recipientList.length > 10) {
      setError("At most 10 recipients per send.");
      return;
    }
    const bad = recipientList.find((a) => !isValidQorAddress(a));
    if (bad) {
      setError(`Not a valid qor1… address: ${bad}`);
      return;
    }
    let amountUqor: string;
    try {
      amountUqor = qorToUqor(amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    const total = BigInt(amountUqor) * BigInt(recipientList.length);
    if (balanceUqor !== null && total > BigInt(balanceUqor)) {
      setError(
        `Total (${uqorToQor(total.toString())} QOR for ${recipientList.length} people) is more than your balance (${uqorToQor(balanceUqor)} QOR). Top up from the faucet first.`,
      );
      return;
    }
    setBusy(true);
    setStatus(
      recipientList.length > 1
        ? `Waiting for your approval in QoreX… (1 tx, ${recipientList.length} recipients)`
        : "Waiting for your approval in QoreX…",
    );
    try {
      const res = await sendBatchTip(
        address,
        recipientList.map((to) => ({ toAddress: to, amountQor: amount })),
        message,
      );
      if (res.code !== 0) {
        setError(`Transaction failed on chain (code ${res.code}). Tx: ${res.txHash}`);
        return;
      }
      let ledger = loadLedger();
      for (const to of recipientList) {
        const record: TipRecord = {
          txHash: res.txHash,
          from: address,
          to,
          amountUqor,
          memo: buildTipMemo(message),
          timestamp: Date.now(),
          shield: res.shield,
        };
        ledger = recordTip(record);
      }
      setTips(ledger);
      setLastTip(res);
      if (res.shield === "shielded") {
        setStatus(
          recipientList.length > 1
            ? `Sent ${uqorToQor(total.toString())} QOR to ${recipientList.length} people in one hybrid-signed tx (secp256k1 + ML-DSA-87). Shield: shielded.`
            : "Tip sent and hybrid-signed (secp256k1 + ML-DSA-87). Shield: shielded.",
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
        margin: "0 auto",
        padding: "2rem 1rem 3rem",
        lineHeight: 1.5,
        color: "#111827",
        background: "transparent",
        position: "relative",
        minHeight: "100vh",
      }}
    >
      <div className="qj-bg" aria-hidden="true">
        <div className="qj-stars" />
        <div className="qj-orb qj-orb-1" />
        <div className="qj-orb qj-orb-2" />
        <div className="qj-orb qj-orb-3" />
        <div className="qj-orb qj-orb-4" />
      </div>
      <div style={{ position: "relative", zIndex: 1 }}>
      <header>
        <img
          src="/cover.jpg"
          alt="Quantum Tip Jar — a glass jar of gold Q coins with purple quantum rings, QoreChain Testnet"
          style={{
            width: "100%",
            borderRadius: 16,
            display: "block",
            boxShadow: "0 8px 32px rgba(109, 40, 217, 0.25)",
          }}
        />
        <h1
          style={{
            marginBottom: 0,
            marginTop: "1rem",
            fontSize: "1.9rem",
            color: "#fff",
            textShadow: "0 2px 16px rgba(124, 58, 237, 0.6)",
          }}
        >
          🫙 Quantum Tip Jar
        </h1>
        <p style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
          <span style={pill}>Hybrid-signed</span>
          <span style={pill}>QoreChain Testnet</span>
          <span style={pill}>Quantum Pass</span>
        </p>
        <p style={{ color: "#e9d5ff", marginTop: "0.25rem" }}>
          Send a testnet QOR tip to one — or up to 10 —{" "}
          <code>qor1…</code> addresses in a single transaction. Every tip
          is a hybrid-signed transaction (secp256k1 + ML-DSA-87) on{" "}
          <code>{CHAIN_NAME}</code>.
        </p>
        <p style={{ color: "#c4b5fd", fontSize: "0.9rem" }}>
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
          Recipients (<code>qor1…</code>, one per line, up to 10)
          <textarea
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder={"qor1…\nqor1…"}
            rows={3}
            style={{ ...inputStyle, marginTop: "0.25rem", resize: "vertical" }}
            aria-label="Recipient addresses, one per line"
          />
        </label>
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Amount per person (QOR)
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 1.5"
            inputMode="decimal"
            style={{ ...inputStyle, marginTop: "0.25rem" }}
            aria-label="Amount in QOR per person"
          />
        </label>
        {totalUqor !== null && recipientList.length > 0 && (
          <p style={{ fontSize: "0.95rem", marginTop: "-0.25rem" }}>
            Total: <strong>{uqorToQor(totalUqor)} QOR</strong> to{" "}
            {recipientList.length} {recipientList.length > 1 ? "people" : "person"} —{" "}
            <span style={{ color: "#555" }}>
              one hybrid-signed transaction, one approval.
            </span>
          </p>
        )}
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
          {busy
            ? "Working…"
            : recipientList.length > 1
              ? `Send tips to ${recipientList.length} people (hybrid-signed)`
              : "Send tip (hybrid-signed)"}
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
        <p
          style={{
            color: "#a7f3d0",
            marginTop: "1rem",
            background: "rgba(6, 95, 70, 0.45)",
            border: "1px solid rgba(167, 243, 208, 0.4)",
            borderRadius: 10,
            padding: "0.6rem 0.9rem",
          }}
          role="status"
        >
          {status}
        </p>
      )}
      {error && (
        <p
          style={{
            color: "#fecaca",
            marginTop: "1rem",
            background: "rgba(127, 29, 29, 0.45)",
            border: "1px solid rgba(252, 165, 165, 0.4)",
            borderRadius: 10,
            padding: "0.6rem 0.9rem",
          }}
          role="alert"
        >
          {error}
        </p>
      )}
      {lastTip && (
        <p style={{ marginTop: "0.5rem", color: "#e9d5ff" }}>
          Tx:{" "}
          <a
            href={txRestUrl(lastTip.txHash)}
            target="_blank"
            rel="noreferrer"
            style={linkLight}
          >
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
                {i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : `${i + 1}. `}
                <code>{shortAddress(row.address)}</code> —{" "}
                <strong>{uqorToQor(row.totalUqor)} QOR</strong> in{" "}
                {row.tipCount} tip{row.tipCount > 1 ? "s" : ""}
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

      <footer style={{ marginTop: "1.5rem", fontSize: "0.9rem", color: "#c4b5fd" }}>
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
          <a href={FEST_URL} target="_blank" rel="noreferrer" style={linkLight}>
            QoreChain Developer Fest
          </a>{" "}
          ·{" "}
          <a href={EXPLORER_HOME} target="_blank" rel="noreferrer" style={linkLight}>
            Explorer
          </a>{" "}
          ·{" "}
          <a href={FAUCET_URL} target="_blank" rel="noreferrer" style={linkLight}>
            Faucet
          </a>
        </p>
      </footer>
      </div>
    </main>
  );
}
