// Сумма прописью на русском: рубли и копейки.
const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUND = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
// [форма для 1, 2–4, 5+], женский род?
const GROUPS = [
  null,
  [["тысяча", "тысячи", "тысяч"], true],
  [["миллион", "миллиона", "миллионов"], false],
  [["миллиард", "миллиарда", "миллиардов"], false],
];

export function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

function triad(n, fem) {
  const out = [];
  const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), o = n % 10;
  if (h) out.push(HUND[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((fem ? ONES_F : ONES_M)[o]);
  }
  return out;
}

/** Целое число прописью (мужской род по умолчанию). */
export function intWords(n, fem = false) {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "ноль";
  const parts = [];
  let g = 0;
  while (n > 0) {
    const tr = n % 1000;
    if (tr) {
      if (g === 0) parts.unshift(...triad(tr, fem));
      else {
        const [forms, f] = GROUPS[g];
        parts.unshift(...triad(tr, f), plural(tr, forms));
      }
    }
    n = Math.floor(n / 1000);
    g++;
  }
  return parts.join(" ");
}

/** «150 000 (сто пятьдесят тысяч) рублей 00 копеек» */
export function moneyWords(amount) {
  const kop = Math.round(Number(amount || 0) * 100);
  const rub = Math.floor(kop / 100), k = kop % 100;
  const w = intWords(rub);
  return `${fmtInt(rub)} (${w}) ${plural(rub, ["рубль", "рубля", "рублей"])} ${String(k).padStart(2, "0")} ${plural(k, ["копейка", "копейки", "копеек"])}`;
}

/** «Сто пятьдесят тысяч рублей 00 копеек» — для счетов и актов */
export function moneyWordsCap(amount) {
  const kop = Math.round(Number(amount || 0) * 100);
  const rub = Math.floor(kop / 100), k = kop % 100;
  const w = intWords(rub);
  return `${w[0].toUpperCase()}${w.slice(1)} ${plural(rub, ["рубль", "рубля", "рублей"])} ${String(k).padStart(2, "0")} ${plural(k, ["копейка", "копейки", "копеек"])}`;
}

export function fmtInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 150000 -> «150 000,00» */
export function fmtMoney(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const [i, d] = v.toFixed(2).split(".");
  return `${fmtInt(Number(i))},${d}`;
}

/** Число прописью в скобках: 5 -> «5 (пяти)» — родительный падеж для сроков нам не нужен, даём именительный. */
export function numWithWords(n, fem = false) {
  return `${n} (${intWords(n, fem)})`;
}
