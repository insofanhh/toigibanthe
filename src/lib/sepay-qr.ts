import banks from "./sepay-banks.json";
export const sepayBanks = banks.map((bank) => ({
  ...bank,
  shortName: bank.short_name,
}));
const normalized = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function sepayBankBin(gateway: string) {
  const found = sepayBanks.filter((bank) =>
    [
      bank.bin,
      bank.code,
      bank.name,
      bank.shortName,
      ...(bank.alias || []),
    ].some((alias) => normalized(alias) === normalized(gateway)),
  );
  return found.length === 1 ? found[0].bin : null;
}
export function sepayQR(input: {
  bankBin: string;
  accountNo: string;
  accountName: string;
  amount: number;
  content: string;
  store?: string;
}) {
  const url = new URL("https://vietqr.app/img");
  for (const [key, value] of Object.entries({
    acc: input.accountNo,
    bank: input.bankBin,
    amount: String(input.amount),
    des: input.content,
    template: "compact",
    showinfo: "true",
    fullacc: "true",
    holder: input.accountName,
    store: input.store || "Tôi gì, bạn đó!",
  }))
    url.searchParams.set(key, value);
  return url.toString();
}
export function sepayOrderCode(payload: {
  code?: string | null;
  content: string;
  description?: string | null;
}) {
  const codes = new Set<string>();
  // Some provider configurations return only the extracted suffix in code.
  if (/^(?:[A-F0-9]{10}|[A-F0-9]{12})$/i.test(payload.code || ""))
    codes.add(payload.code!.toUpperCase());
  for (const text of [payload.code, payload.content, payload.description]) {
    for (const match of (text || "")
      .toUpperCase()
      .matchAll(
        /(?:^|[^A-Z0-9])TGBD\s*([A-F0-9]{12}|[A-F0-9]{10})(?![A-Z0-9])/g,
      ))
      codes.add(match[1]);
  }
  return codes.size === 1 ? [...codes][0] : null;
}
