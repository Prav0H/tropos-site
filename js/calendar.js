// Производственный календарь РФ: выходные и праздники, рабочие дни.
// Список праздников хранится в настройках (можно править), здесь — значения по умолчанию.
export const DEFAULT_HOLIDAYS = {
  // 2026: постановление о переносе выходных — 3 янв → 9 янв, 4 янв → 31 дек.
  "2026": [
    "2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
    "2026-02-23", "2026-03-09", "2026-05-01", "2026-05-11", "2026-06-12", "2026-11-04", "2026-12-31",
  ],
  // 2027: базовые праздники без переносов — проверить, когда выйдет постановление.
  "2027": [
    "2027-01-01", "2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08",
    "2027-02-23", "2027-03-08", "2027-05-03", "2027-05-10", "2027-06-14", "2027-11-04",
  ],
};
// Рабочие субботы (переносы), если будут.
export const DEFAULT_WORKDAYS = { "2026": [], "2027": [] };

let HOL = new Set(Object.values(DEFAULT_HOLIDAYS).flat());
let WORK = new Set(Object.values(DEFAULT_WORKDAYS).flat());

export function setCalendar(holidays, workdays) {
  if (holidays) HOL = new Set(Object.values(holidays).flat());
  if (workdays) WORK = new Set(Object.values(workdays).flat());
}

export function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
export function parse(s) {
  if (!s) return null;
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function today() { return iso(new Date()); }

export function isWorkday(s) {
  const d = parse(s), k = iso(d), wd = d.getDay();
  if (WORK.has(k)) return true;
  if (wd === 0 || wd === 6) return false;
  return !HOL.has(k);
}

/** Следующий рабочий день строго после даты. */
export function nextWorkday(s) {
  const d = parse(s);
  do d.setDate(d.getDate() + 1); while (!isWorkday(d));
  return iso(d);
}

/** Дата + N рабочих дней (первый день — следующий после даты). */
export function addWorkdays(s, n) {
  let d = iso(parse(s));
  for (let i = 0; i < n; i++) d = nextWorkday(d);
  return d;
}

/** Сколько рабочих дней осталось от сегодня до даты (0 — сегодня, отрицательное — просрочено). */
export function workdaysUntil(target, from = today()) {
  const a = parse(from), b = parse(target);
  if (iso(a) === iso(b)) return 0;
  const sign = b > a ? 1 : -1;
  let n = 0, d = new Date(a);
  while (iso(d) !== iso(b)) {
    d.setDate(d.getDate() + sign);
    if (isWorkday(d)) n += sign;
  }
  return n;
}

export function addMonths(s, n) {
  const d = parse(s);
  const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
}

export function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); }

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
/** «13» ноября 2026 г. */
export function dateText(s) {
  const d = parse(s);
  if (!d) return "«___» ____________ 20__ г.";
  return `«${String(d.getDate()).padStart(2, "0")}» ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} г.`;
}
/** 13.11.2026 */
export function dmy(s) {
  const d = parse(s);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}
/** 13.11.26 — для номера договора */
export function dmyShort(s) {
  const d = parse(s);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getFullYear()).slice(2)}`;
}
