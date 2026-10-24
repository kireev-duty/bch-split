import { WizardConnectQRDialog } from "@wizardconnect/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Bill, type Currency, billUrl, decodeBill, encodeBill, newBillId, sharePerPerson } from "./bill";
import { type Payment, SATS_PER_BCH, bchUsdPrice, findPayments, lockingBytecode, watchAddress } from "./chain";
import { PROJECT } from "./config";
import { Qr } from "./Qr";
import { useWallet } from "./useWallet";
import { payShare } from "./wallet";

const explorer = (txid: string) => `https://blockchair.com/bitcoin-cash/transaction/${txid}`;
const formatBch = (sats: number) => `${(sats / SATS_PER_BCH).toFixed(sats < 1e6 ? 6 : 4)} BCH`;
const formatUsd = (usd: number) => `$${usd.toFixed(2)}`;

function useHashBill() {
  const [bill, setBill] = useState(() => decodeBill(location.hash.slice(1)));
  useEffect(() => {
    const onHash = () => setBill(decodeBill(location.hash.slice(1)));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  return bill;
}

function usePrice() {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    const load = () => bchUsdPrice().then(setPrice).catch(() => {});
    load();
    const timer = setInterval(load, 120_000);
    return () => clearInterval(timer);
  }, []);
  return price;
}

export default function App() {
  const bill = useHashBill();
  const wallet = useWallet();
  const price = usePrice();

  return (
    <div className="page">
      <div className="blaze">
        <span>BCH BLAZE 2026 entry</span>
        <a href={PROJECT.presentationUrl} target="_blank" rel="noreferrer">Presentation</a>
        <a href={PROJECT.repoUrl} target="_blank" rel="noreferrer">Source code</a>
        <span>
          EMBER2026 votes: <code>{PROJECT.donationAddress}</code>
        </span>
      </div>
      <header>
        <a className="brand" href={location.pathname}>
          <img src="icon.svg" alt="" width={28} height={28} />
          Split the Bill
        </a>
        <WalletBadge wallet={wallet} />
      </header>

      {bill ? <BillView bill={bill} wallet={wallet} price={price} /> : <CreateBill wallet={wallet} />}

      {wallet.showQr && wallet.uri && wallet.qrUri && (
        <WizardConnectQRDialog
          show
          onClose={wallet.closeQr}
          uri={wallet.uri}
          qrUri={wallet.qrUri}
          title="Connect a BCH wallet"
          subtitle="Scan with a WizardConnect wallet"
          theme={{ dialogBackground: "#0f1720", headerBackground: "#0f1720" }}
        />
      )}

      <footer>
        Payments go straight from wallet to wallet on Bitcoin Cash mainnet. No accounts, no server:
        the bill lives in the link and every payment carries an on-chain memo.
      </footer>
    </div>
  );
}

type Wallet = ReturnType<typeof useWallet>;

function WalletBadge({ wallet }: { wallet: Wallet }) {
  if (!wallet.ready) {
    return (
      <button className="ghost" onClick={() => wallet.connect()}>
        {wallet.state === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }
  return (
    <div className="badge">
      {wallet.walletIcon && <img src={wallet.walletIcon} alt="" width={20} height={20} />}
      <span>{wallet.walletName ?? "Wallet"}</span>
      {wallet.balance != null && <span className="muted">{formatBch(wallet.balance)}</span>}
      <button className="link" onClick={() => wallet.disconnect()}>
        Disconnect
      </button>
    </div>
  );
}

function CreateBill({ wallet }: { wallet: Wallet }) {
  const [title, setTitle] = useState("");
  const [payTo, setPayTo] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [total, setTotal] = useState("");
  const [people, setPeople] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.address && !payTo) setPayTo(wallet.address);
  }, [wallet.address, payTo]);

  const names = people
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter(Boolean);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const address = payTo.trim().startsWith("bitcoincash:") ? payTo.trim() : `bitcoincash:${payTo.trim()}`;
    try {
      lockingBytecode(address);
    } catch {
      return setError("That is not a valid Bitcoin Cash address");
    }
    const amount = Number(total);
    if (!(amount > 0)) return setError("Enter the bill total");
    if (names.length < 1) return setError("Add at least one person");
    if (new Set(names).size !== names.length) return setError("Names must be unique");
    const bill: Bill = {
      id: newBillId(),
      title: title.trim() || "Shared bill",
      payTo: address,
      currency,
      total: amount,
      people: names,
    };
    location.hash = encodeBill(bill);
  };

  return (
    <main className="card">
      <h1>Split a bill in BCH</h1>
      <p className="muted">
        Create a bill, send the link to your friends, and watch the shares arrive in real time.
      </p>
      <form onSubmit={submit}>
        <label>
          What is it for?
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Friday dinner" />
        </label>
        <label>
          Your BCH address (payments go here)
          <div className="row">
            <input
              value={payTo}
              onChange={(e) => setPayTo(e.target.value)}
              placeholder="bitcoincash:q…"
              spellCheck={false}
            />
            {!wallet.ready && (
              <button type="button" className="ghost" onClick={() => wallet.connect()}>
                Use my wallet
              </button>
            )}
          </div>
        </label>
        <label>
          Total
          <div className="row">
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              inputMode="decimal"
              placeholder={currency === "USD" ? "84.00" : "0.25"}
            />
            <div className="segmented">
              {(["USD", "BCH"] as const).map((c) => (
                <button type="button" key={c} className={c === currency ? "on" : ""} onClick={() => setCurrency(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </label>
        <label>
          Who is splitting? (one per line or comma separated)
          <textarea value={people} onChange={(e) => setPeople(e.target.value)} rows={4} placeholder={"Alice\nBob\nCarol"} />
        </label>
        {names.length > 0 && Number(total) > 0 && (
          <p className="hint">
            {names.length} people × {currency === "USD" ? formatUsd(Number(total) / names.length) : `${(Number(total) / names.length).toFixed(6)} BCH`} each
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit">
          Create bill
        </button>
      </form>
    </main>
  );
}

type PayState = { name: string; status: "connecting" | "signing" | "done" | "error"; message?: string };

function BillView({ bill, wallet, price }: { bill: Bill; wallet: Wallet; price: number | null }) {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pay, setPay] = useState<PayState | null>(null);
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => billUrl(bill), [bill]);

  const share = sharePerPerson(bill);
  const shareSats =
    bill.currency === "BCH"
      ? Math.round(share * SATS_PER_BCH)
      : price
        ? Math.round((share / price) * SATS_PER_BCH)
        : null;

  const refresh = useCallback(async () => {
    try {
      setPayments(await findPayments(bill.payTo, bill.id));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  }, [bill.payTo, bill.id]);

  useEffect(() => {
    refresh();
    let stop: (() => void) | undefined;
    watchAddress(bill.payTo, refresh)
      .then((unwatch) => (stop = unwatch))
      .catch(() => {});
    const timer = setInterval(refresh, 30_000);
    return () => {
      stop?.();
      clearInterval(timer);
    };
  }, [bill.payTo, refresh]);

  const paidBy = new Map<string, Payment[]>();
  for (const p of payments ?? []) paidBy.set(p.name, [...(paidBy.get(p.name) ?? []), p]);
  const paidCount = bill.people.filter((n) => paidBy.has(n)).length;
  const receivedSats = (payments ?? []).reduce((sum, p) => sum + p.sats, 0);
  const extras = [...paidBy.keys()].filter((n) => !bill.people.includes(n));

  const payAs = async (name: string) => {
    if (!shareSats) return;
    setPay({ name, status: "connecting" });
    const connected = await wallet.connect();
    if (!connected || !wallet.manager) return setPay(null);
    setPay({ name, status: "signing" });
    try {
      await payShare(wallet.manager, {
        to: bill.payTo,
        sats: shareSats,
        billId: bill.id,
        name,
        prompt: `${bill.title}: ${name}'s share`,
      });
      setPay({ name, status: "done" });
      refresh();
      wallet.refreshBalance();
    } catch (error) {
      setPay({ name, status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const totalLabel = bill.currency === "USD" ? formatUsd(bill.total) : `${bill.total} BCH`;
  const shareLabel = bill.currency === "USD" ? formatUsd(share) : `${share.toFixed(6)} BCH`;

  return (
    <main className="bill">
      <section className="card">
        <div className="bill-head">
          <div>
            <h1>{bill.title}</h1>
            <p className="muted">
              {totalLabel} · {bill.people.length} people · {shareLabel} each
              {bill.currency === "USD" && shareSats && <> ≈ {formatBch(shareSats)}</>}
            </p>
          </div>
          <div className="progress-num">
            {paidCount}/{bill.people.length}
            <span>paid</span>
          </div>
        </div>
        <div className="progress">
          <div style={{ width: `${(paidCount / bill.people.length) * 100}%` }} />
        </div>

        <ul className="people">
          {bill.people.map((name) => {
            const paid = paidBy.get(name);
            const busy = pay?.name === name && (pay.status === "connecting" || pay.status === "signing");
            return (
              <li key={name} className={paid ? "paid" : ""}>
                <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
                <span className="name">{name}</span>
                {paid ? (
                  <a className="status ok" href={explorer(paid[0].txid)} target="_blank" rel="noreferrer">
                    {paid[0].confirmed ? "Paid" : "Paid · unconfirmed"} · {formatBch(paid.reduce((s, p) => s + p.sats, 0))}
                  </a>
                ) : (
                  <button className="primary small" disabled={!shareSats || busy || pay?.status === "signing"} onClick={() => payAs(name)}>
                    {busy ? (pay.status === "connecting" ? "Connecting…" : "Approve in wallet…") : `I'm ${name} · pay`}
                  </button>
                )}
              </li>
            );
          })}
          {extras.map((name) => (
            <li key={name} className="paid extra">
              <span className="avatar">+</span>
              <span className="name">{name}</span>
              <a className="status ok" href={explorer(paidBy.get(name)![0].txid)} target="_blank" rel="noreferrer">
                extra · {formatBch(paidBy.get(name)!.reduce((s, p) => s + p.sats, 0))}
              </a>
            </li>
          ))}
        </ul>

        {pay?.status === "done" && <p className="success">Thanks {pay.name}! Your share is on its way.</p>}
        {pay?.status === "error" && <p className="error">{pay.message}</p>}
        {loadError && <p className="error">Could not reach the BCH network: {loadError}</p>}
        {payments == null && !loadError && <p className="muted">Looking for payments on-chain…</p>}
        {!shareSats && <p className="muted">Loading BCH price…</p>}
        <p className="muted small">
          Received so far: {formatBch(receivedSats)}
          {price && <> ≈ {formatUsd((receivedSats / SATS_PER_BCH) * price)}</>}
        </p>
      </section>

      <aside className="card share">
        <h2>Invite the group</h2>
        <Qr value={url} size={180} />
        <button className="ghost" onClick={copy}>
          {copied ? "Link copied" : "Copy link"}
        </button>
        {"share" in navigator && (
          <button className="ghost" onClick={() => navigator.share({ title: bill.title, url })}>
            Share…
          </button>
        )}
        <p className="muted small">
          Paying to <code>{bill.payTo.replace("bitcoincash:", "").slice(0, 10)}…{bill.payTo.slice(-6)}</code>
        </p>
      </aside>
    </main>
  );
}
