# Split the Bill · BCH

Split a dinner, a trip or a shared subscription with friends and get paid in Bitcoin Cash.
No sign-up, no backend, no custody.

**Live demo:** https://kireev-duty.github.io/bch-split/ <!-- update after the first deploy -->

## How it works

1. The organiser enters a title, their BCH address, the total (USD or BCH) and the names.
2. The app turns the bill into a link. The whole bill lives in the URL fragment, so there is
   no database and nothing to host except static files.
3. Everyone opens the link, taps **I'm Bob · pay**, connects their wallet with
   **WizardConnect** (scan the QR) and approves one transaction.
4. The transaction pays the share to the organiser and carries an `OP_RETURN` memo
   `split <billId> <name>`. The bill page subscribes to the organiser's address through
   an Electrum server, decodes the memos and ticks people off in real time.

USD bills are converted at the live BCH price when each person pays.

```
 friend's wallet ──WizardConnect (nostr relay, E2E)──► dapp builds unsigned tx
        │                                                   │ share → organiser
        │ signs + broadcasts                                │ OP_RETURN "split" id name
        ▼                                                   │ change → wallet change path
  BCH mainnet ◄─────────────────────────────────────────────┘
        │
        └── Electrum (blockchain.address.subscribe) ──► bill page marks "Paid"
```

## Tech

- React + Vite, static build deployed to GitHub Pages
- `@wizardconnect/react` / `@wizardconnect/dapp` for wallet connection and signing
  (`hdwalletv1` protocol, xpub-based address discovery, `inputPaths` signing)
- `@bitauth/libauth` for addresses, transaction encoding and the memo script
- `@electrum-cash/network` for UTXOs, history and live address subscriptions
  (public Fulcrum servers with fallback)

Source layout:

| File | What it does |
|---|---|
| `src/bill.ts` | bill model, link encoding |
| `src/chain.ts` | Electrum access, memo encode/decode, payment discovery, price |
| `src/wallet.ts` | address scan over the wallet xpubs, coin selection, tx building, sign request |
| `src/useWallet.ts` | WizardConnect hook wrapper |
| `src/App.tsx` | UI |

## Run locally

```bash
npm install
npm run dev
```

## Roadmap

- Fallback BIP21 QR for wallets without WizardConnect (matched by amount)
- CashTokens receipt NFT for every paid share
- Recurring splits (rent, subscriptions) with reminders
- Multi-currency totals (EUR, local currencies)

## License

MIT
