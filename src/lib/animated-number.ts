/** Preserve the displayed locale, units and decimal precision during interpolation. */
export function animatedNumber(value: string | number) {
  const text = String(value);
  const match = text.match(/^([^\d]*?)(\d[\d.,]*)([^\d]*)$/);
  if (!match) return null;
  let [, prefix, digits, suffix] = match;
  if (/^0\d/.test(digits) || /[A-Za-z#]$/.test(prefix)) return null;
  const unit = suffix.trim();
  if (
    unit &&
    !/^(?:\+|%|đ|₫|km|phút|giây|ngày|tuần|tháng|năm|đơn|món|phần|suất|người|lượt|lần|bản ghi|★|k)(?:[\s.!?].*)?$/.test(
      unit,
    )
  )
    return null;
  const negative = /[-−]\s*$/.test(prefix);
  const plus = /\+\s*$/.test(prefix);
  const sign = prefix.match(/[-−+]\s*$/)?.[0] || "";
  prefix = prefix.slice(0, prefix.length - sign.length);
  const decimalComma = digits.includes(",");
  const dotGroups =
    !decimalComma &&
    /^\d{1,3}(?:\.\d{3})+$/.test(digits) &&
    !unit.startsWith("%");
  const decimalDigits = decimalComma
    ? digits.split(",")[1].length
    : !dotGroups && digits.includes(".")
      ? digits.split(".")[1].length
      : 0;
  const number =
    Number(
      decimalComma
        ? digits.replaceAll(".", "").replace(",", ".")
        : dotGroups
          ? digits.replaceAll(".", "")
          : digits,
    ) * (negative ? -1 : 1);
  if (
    !Number.isFinite(number) ||
    Math.abs(number) > Number.MAX_SAFE_INTEGER ||
    decimalDigits > 6
  )
    return null;
  const currency = /^[đ₫]/.test(unit);
  const grouped =
    dotGroups || (decimalComma && digits.includes(".")) || currency;
  const formatter = new Intl.NumberFormat(
    decimalComma || dotGroups || currency ? "vi-VN" : "en-US",
    {
      useGrouping: grouped,
      minimumFractionDigits: decimalDigits,
      maximumFractionDigits: decimalDigits,
    },
  );
  return {
    value: number,
    format: (n: number) =>
      prefix +
      (n < 0 ? (sign.includes("−") ? "−" : "-") : plus ? "+" : "") +
      formatter.format(Math.abs(n)) +
      suffix,
  };
}
