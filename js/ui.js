// Мелкие помощники интерфейса.
import { fmtMoney } from "./words.js?v=15";
import { dmy } from "./calendar.js?v=15";

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const rub = (n) => fmtMoney(n).replace(/,00$/, "") + " ₽";
export const d = (s) => (s ? dmy(s) : "—");
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(text, err = false) {
  const r = document.getElementById("toastRoot");
  r.innerHTML = `<div class="toast${err ? " err" : ""}">${esc(text)}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (r.innerHTML = ""), err ? 5000 : 2500);
}

/** Модальное окно. Возвращает элемент окна и функцию закрытия. */
export function modal({ title, body, footer = "", wide = false, onMount }) {
  const root = document.getElementById("modalRoot");
  const wrap = document.createElement("div");
  wrap.className = "scrim";
  wrap.innerHTML = `<div class="modal${wide ? " wide" : ""}" role="dialog" aria-label="${esc(title)}">
    <div class="mh"><h2>${esc(title)}</h2><button class="btn ghost" data-close aria-label="Закрыть">✕</button></div>
    <div class="mb">${body}</div>${footer ? `<div class="mf">${footer}</div>` : ""}</div>`;
  root.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  const el = wrap.querySelector(".modal");
  if (onMount) onMount(el, close);
  const first = el.querySelector("input,select,textarea");
  if (first) setTimeout(() => first.focus(), 30);
  return { el, close };
}

/** Окно подтверждения внутри страницы (вместо confirm). */
export function confirmBox(text, okLabel = "Да") {
  return new Promise((res) => {
    modal({
      title: "Подтверждение", body: `<p style="margin:0">${esc(text)}</p>`,
      footer: `<button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>${esc(okLabel)}</button>`,
      onMount: (el, close) => {
        el.querySelector("[data-ok]").onclick = () => { close(); res(true); };
        el.closest(".scrim").addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target.classList.contains("scrim")) res(false); });
      },
    });
  });
}

/** Поле формы. */
export function field(label, name, value = "", opts = {}) {
  const { type = "text", ph = "", req = false, rows = 0, options = null, hint = "", attrs = "" } = opts;
  let input;
  if (options) {
    input = `<select name="${name}" ${attrs}>${options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === String(value ?? "") ? " selected" : ""}>${esc(l)}</option>`;
    }).join("")}</select>`;
  } else if (rows) input = `<textarea name="${name}" rows="${rows}" placeholder="${esc(ph)}" ${attrs}>${esc(value)}</textarea>`;
  else input = `<input name="${name}" type="${type}" value="${esc(value ?? "")}" placeholder="${esc(ph)}"${req ? " required" : ""} ${attrs}>`;
  return `<label class="f">${esc(label)}${req ? " *" : ""}${input}${hint ? `<span class="small muted">${esc(hint)}</span>` : ""}</label>`;
}

/** Собрать значения полей [name] внутри элемента. */
export function formData(root) {
  const o = {};
  $$("[name]", root).forEach((el) => {
    if (el.type === "checkbox") o[el.name] = el.checked;
    else if (el.type === "number") o[el.name] = el.value === "" ? null : Number(el.value);
    else o[el.name] = el.value.trim();
  });
  return o;
}

export const STATUS = {
  contract: {
    draft: ["Черновик", ""], sent: ["Отправлен", "info"], signed: ["Подписан", "acc"], work: ["В работе", "warn"],
    delivered: ["Сдан", "good"], support: ["Сопровождение", "info"], closed: ["Закрыт", "good"], terminated: ["Расторгнут", "bad"],
  },
  invoice: { issued: ["Выставлен", "info"], paid: ["Оплачен", "good"], overdue: ["Просрочен", "bad"], cancelled: ["Отменён", ""] },
  act: { draft: ["Не отправлен", ""], sent: ["Отправлен", "info"], signed: ["Подписан", "good"], rejected: ["Мотивированный отказ", "bad"], accepted_default: ["Принят по умолчанию", "warn"] },
  vs: { sent: ["Передано", "info"], work: ["В работе", "warn"], done: ["Сделано", "good"], rejected: ["Отклонено", ""] },
};
export function pill(kind, s) {
  const [l, c] = (STATUS[kind] && STATUS[kind][s]) || [s, ""];
  return `<span class="st ${c}">${esc(l)}</span>`;
}

/** Скачать файл (Blob) с именем. */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; if (text) btn.textContent = text; }
  else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
}

/** Подгрузить скрипт один раз (тяжёлые библиотеки PDF и Word — только когда нужны). */
const _scripts = {};
export function loadScript(src) {
  return (_scripts[src] = _scripts[src] || new Promise((res, rej) => { const e = document.createElement("script"); e.src = src; e.onload = res; e.onerror = () => { delete _scripts[src]; rej(new Error("Не загрузилась библиотека документов — проверьте интернет")); }; document.head.appendChild(e); }));
}
export async function needPdf() { if (!window.pdfMake) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js"); if (!window.pdfMake.vfs) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js"); }
export async function needDocx() { if (!window.docx) await loadScript("https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js"); }
