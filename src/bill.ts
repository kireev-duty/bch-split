export type Currency = "USD" | "BCH";

export interface Bill {
  id: string;
  title: string;
  payTo: string;
  currency: Currency;
  total: number;
  people: string[];
}

const toBase64Url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (value: string) => {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const newBillId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

export const encodeBill = (bill: Bill) =>
  toBase64Url(JSON.stringify([bill.id, bill.title, bill.payTo, bill.currency, bill.total, bill.people]));

export function decodeBill(hash: string): Bill | null {
  try {
    const [id, title, payTo, currency, total, people] = JSON.parse(fromBase64Url(hash));
    if (typeof id !== "string" || !Array.isArray(people)) return null;
    return { id, title, payTo, currency, total, people };
  } catch {
    return null;
  }
}

export const billUrl = (bill: Bill) =>
  `${location.origin}${location.pathname}#${encodeBill(bill)}`;

export const sharePerPerson = (bill: Bill) => bill.total / bill.people.length;
