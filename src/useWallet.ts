import { useWizardConnect } from "@wizardconnect/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { primaryAddress, walletBalance } from "./wallet";

export function useWallet() {
  const wc = useWizardConnect({
    dappName: "Split the Bill",
    dappIcon: new URL("icon.svg", location.href).href,
  });
  const [balance, setBalance] = useState<number | null>(null);
  const [showQr, setShowQr] = useState(false);
  const waiters = useRef<((ok: boolean) => void)[]>([]);
  const ready = wc.state === "connected" && wc.manager != null && primaryAddress(wc.manager) != null;

  const refreshBalance = useCallback(async () => {
    if (!wc.manager || !ready) return;
    try {
      setBalance(await walletBalance(wc.manager));
    } catch {
      setBalance(null);
    }
  }, [wc.manager, ready]);

  useEffect(() => {
    if (!ready) return;
    setShowQr(false);
    refreshBalance();
    waiters.current.splice(0).forEach((resolve) => resolve(true));
  }, [ready, refreshBalance]);

  const connect = useCallback(() => {
    if (ready) return Promise.resolve(true);
    if (wc.state !== "connecting") wc.connect();
    setShowQr(true);
    return new Promise<boolean>((resolve) => waiters.current.push(resolve));
  }, [ready, wc]);

  const closeQr = useCallback(() => {
    setShowQr(false);
    waiters.current.splice(0).forEach((resolve) => resolve(false));
    if (!ready) wc.disconnect();
  }, [ready, wc]);

  return {
    ...wc,
    ready,
    address: ready ? primaryAddress(wc.manager!) : null,
    balance,
    refreshBalance,
    connect,
    showQr: showQr && wc.uri != null && !ready,
    closeQr,
  };
}
