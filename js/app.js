import * as store from './store.js';
const { state } = store;

/* ================= constants & helpers ================= */

const EXPENSE_DEFAULTS = ['Food & Dining', 'Groceries', 'Transport', 'Rent', 'Utilities', 'Shopping', 'Health', 'Entertainment', 'Education', 'Travel', 'Other'];
const INCOME_DEFAULTS = ['Salary', 'Freelance', 'Interest', 'Investments', 'Gift', 'Refund', 'Other'];
const ACCOUNT_TYPES = ['Bank', 'Cash', 'Credit card', 'Wallet', 'Investment', 'Other'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];
const PALETTE = ['#2a78d6', '#e0823d', '#3fa56b', '#c7508c', '#8a6fd1', '#c9a227', '#3aa7ad', '#d65b4a', '#7d8a99'];
const INCOME_COLOR = '#2f9e6b';
const EXPENSE_COLOR = '#d9603f';
const PERIODS = { 'this-month': 'This month', 'last-month': 'Last month', 'last-3': 'Last 3 months', 'this-year': 'This year', all: 'All time' };

const ui = {
  view: 'dashboard',
  period: 'this-month',
  filters: { q: '', type: '', account: '', category: '', from: '', to: '' },
  lastAccount: '',
};
let charts = [];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const cents = n => Math.round((Number(n) || 0) * 100);

function fmt(amount) {
  const currency = state.settings.currency || 'INR';
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${Number(amount).toFixed(2)}`;
  }
}
const fmtC = c => fmt(c / 100);
function fmtDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return esc(s);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 4500);
}

/* ================= selectors ================= */

const findAcc = id => state.accounts.find(a => a.id === id);
const findTx = id => state.transactions.find(t => t.id === id);
const accName = id => findAcc(id)?.name ?? '(deleted account)';
const sortedAccounts = () => [...state.accounts].sort((a, b) => a.name.localeCompare(b.name));
const sortedTx = () => [...state.transactions].sort((a, b) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0));

/** Balances are always derived: opening balance + income − expense ± transfers.
 *  So deleting or editing a transaction is reflected in the account automatically. */
function balances() {
  const m = new Map(state.accounts.map(a => [a.id, cents(a.openingBalance)]));
  const add = (id, c) => { if (m.has(id)) m.set(id, m.get(id) + c); };
  for (const t of state.transactions) {
    const c = cents(t.amount);
    if (t.type === 'income') add(t.accountId, c);
    else if (t.type === 'expense') add(t.accountId, -c);
    else if (t.type === 'transfer') { add(t.accountId, -c); add(t.toAccountId, c); }
  }
  return m;
}

function periodRange(p) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth();
  switch (p) {
    case 'this-month': return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    case 'last-month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    case 'last-3': return [iso(new Date(y, m - 2, 1)), iso(new Date(y, m + 1, 0))];
    case 'this-year': return [`${y}-01-01`, `${y}-12-31`];
    default: return ['', ''];
  }
}
const inRange = (t, from, to) => (!from || t.date >= from) && (!to || t.date <= to);

function totalsByCategory(txs, type) {
  const m = new Map();
  for (const t of txs) if (t.type === type) m.set(t.category, (m.get(t.category) || 0) + cents(t.amount));
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Categories for a type, most frequently used first, then the defaults. */
function rankedCategories(type) {
  const count = new Map();
  for (const t of state.transactions) if (t.type === type && t.category) count.set(t.category, (count.get(t.category) || 0) + 1);
  const used = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
  const defaults = (type === 'income' ? INCOME_DEFAULTS : EXPENSE_DEFAULTS)
    .filter(n => !count.has(n)).map(name => ({ name, n: 0 }));
  return [...used, ...defaults];
}

/* ================= shell ================= */

function render() {
  $('#boot').hidden = state.ready;
  if (!state.ready) return;
  const signedIn = !!state.user;
  $('#login').hidden = signedIn;
  $('#app').hidden = !signedIn;
  if (!signedIn) return;

  $('#who').textContent = state.user.email;
  $('#signoutBtn').hidden = !!state.user.local;
  const banner = $('#banner');
  if (state.error) {
    banner.hidden = false; banner.className = 'banner error'; banner.textContent = state.error;
  } else if (state.user.local) {
    banner.hidden = false; banner.className = 'banner';
    banner.textContent = 'Local mode: data is stored only in this browser and is not protected by a login. Add your Firebase config (see README) for secure, synced storage.';
  } else banner.hidden = true;

  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === ui.view));
  charts.forEach(c => c.destroy());
  charts = [];
  const view = $('#view');
  if (!state.loaded) { view.innerHTML = '<p class="muted pad">Loading your data…</p>'; return; }
  ({ dashboard: renderDashboard, transactions: renderTransactions, accounts: renderAccounts, settings: renderSettings }[ui.view])(view);
  applyDataStyles(view);
}

// CSP forbids inline styles in markup, so dynamic widths are applied from data attributes.
function applyDataStyles(root) {
  $$('[data-w]', root).forEach(el => { el.style.width = el.dataset.w + '%'; });
}

function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }

/* ================= dashboard ================= */

function renderDashboard(view) {
  if (!state.accounts.length) {
    view.innerHTML = `<section class="card empty"><h2>Welcome</h2>
      <p class="muted">Start by adding an account (bank, cash, wallet…). Then record income and expenses against it.</p>
      <button class="btn primary" data-act="add-acc">Add your first account</button></section>`;
    return;
  }
  const [from, to] = periodRange(ui.period);
  const txs = state.transactions.filter(t => inRange(t, from, to));
  const sum = type => txs.reduce((s, t) => s + (t.type === type ? cents(t.amount) : 0), 0);
  const inc = sum('income'), exp = sum('expense');
  const net = [...balances().values()].reduce((a, b) => a + b, 0);
  const expCats = totalsByCategory(txs, 'expense'), incCats = totalsByCategory(txs, 'income');
  const topUsed = type => rankedCategories(type).filter(c => c.n)[0];
  const tu = topUsed('expense'), ti = topUsed('income');

  view.innerHTML = `
    <div class="row between">
      <div class="quick">
        <button class="btn expense" data-act="add-tx" data-type="expense">+ Expense</button>
        <button class="btn income" data-act="add-tx" data-type="income">+ Income</button>
        <button class="btn" data-act="add-tx" data-type="transfer">Transfer</button>
      </div>
      <label class="inline">Period
        <select data-ui="period">${Object.entries(PERIODS).map(([k, v]) => `<option value="${k}" ${k === ui.period ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </label>
    </div>
    <section class="stats">
      <div class="card stat"><span>Total balance</span><b>${fmtC(net)}</b><small>across ${state.accounts.length} account${state.accounts.length > 1 ? 's' : ''}</small></div>
      <div class="card stat"><span>Income</span><b class="income">${fmtC(inc)}</b><small>${PERIODS[ui.period]}</small></div>
      <div class="card stat"><span>Expenses</span><b class="expense">${fmtC(exp)}</b><small>${PERIODS[ui.period]}</small></div>
      <div class="card stat"><span>Saved</span><b>${fmtC(inc - exp)}</b><small>${inc > 0 ? Math.round((inc - exp) / inc * 100) + '% of income' : 'income − expenses'}</small></div>
    </section>
    <section class="card insights">
      <div><span>Most common expense category</span><b>${tu ? `${esc(tu.name)} <small>(${tu.n} ${tu.n === 1 ? "entry" : "entries"})</small>` : '—'}</b></div>
      <div><span>Most common income category</span><b>${ti ? `${esc(ti.name)} <small>(${ti.n} ${ti.n === 1 ? "entry" : "entries"})</small>` : '—'}</b></div>
      <div><span>Biggest expense category, ${PERIODS[ui.period].toLowerCase()}</span><b>${expCats[0] ? `${esc(expCats[0][0])} <small>(${fmtC(expCats[0][1])})</small>` : '—'}</b></div>
    </section>
    <section class="grid2">
      <div class="card"><h3>Expenses by category</h3>${expCats.length ? '<div class="chart"><canvas id="pieExp"></canvas></div>' : '<p class="muted nodata">No expenses in this period.</p>'}</div>
      <div class="card"><h3>Income by category</h3>${incCats.length ? '<div class="chart"><canvas id="pieInc"></canvas></div>' : '<p class="muted nodata">No income in this period.</p>'}</div>
    </section>
    <section class="card"><h3>Income vs expenses, last 12 months</h3><div class="chart wide"><canvas id="barMonthly"></canvas></div></section>
    ${budgetSection()}
    <section class="card"><div class="row between"><h3>Recent transactions</h3><button class="btn link" data-act="nav" data-view="transactions">View all</button></div>
      ${txTable(sortedTx().slice(0, 6))}</section>`;

  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue('--muted').trim(), surface = css.getPropertyValue('--surface').trim(), line = css.getPropertyValue('--line').trim();
  Chart.defaults.color = text;
  Chart.defaults.font.family = css.getPropertyValue('--font').trim();
  const pie = (id, cats) => {
    if (!cats.length) return;
    // Keep the pie readable: top 8 categories, the rest grouped as "Other categories".
    let rows = cats;
    if (cats.length > 9) rows = [...cats.slice(0, 8), ['Other categories', cats.slice(8).reduce((s, c) => s + c[1], 0)]];
    const total = rows.reduce((s, r) => s + r[1], 0);
    charts.push(new Chart($('#' + id), {
      type: 'doughnut',
      data: {
        labels: rows.map(r => `${r[0]} · ${Math.round(r[1] / total * 100)}%`),
        datasets: [{ data: rows.map(r => r[1] / 100), backgroundColor: PALETTE, borderColor: surface, borderWidth: 2 }],
      },
      options: {
        maintainAspectRatio: false, cutout: '55%',
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, boxHeight: 12 } },
          tooltip: { callbacks: { label: c => ' ' + fmt(c.parsed) } },
        },
      },
    }));
  };
  pie('pieExp', expCats);
  pie('pieInc', incCats);

  const months = [], now = new Date();
  for (let i = 11; i >= 0; i--) months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const monthly = type => months.map(m => state.transactions.reduce((s, t) => s + (t.type === type && t.date.startsWith(key(m)) ? cents(t.amount) : 0), 0) / 100);
  charts.push(new Chart($('#barMonthly'), {
    type: 'bar',
    data: {
      labels: months.map(m => m.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })),
      datasets: [
        { label: 'Income', data: monthly('income'), backgroundColor: INCOME_COLOR, borderRadius: 3 },
        { label: 'Expenses', data: monthly('expense'), backgroundColor: EXPENSE_COLOR, borderRadius: 3 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: line }, ticks: { callback: v => Intl.NumberFormat(undefined, { notation: 'compact' }).format(v) } } },
      plugins: { legend: { labels: { boxWidth: 12, boxHeight: 12 } }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
    },
  }));
}

function budgetSection() {
  const budgets = Object.entries(state.settings.budgets || {});
  if (!budgets.length) return '';
  const [from, to] = periodRange('this-month');
  const spent = new Map(totalsByCategory(state.transactions.filter(t => inRange(t, from, to)), 'expense'));
  return `<section class="card"><h3>Budgets, this month</h3>${budgets.map(([cat, limit]) => {
    const s = (spent.get(cat) || 0) / 100, pct = limit > 0 ? s / limit * 100 : 0;
    return `<div class="budget"><div class="row between"><span>${esc(cat)}</span><span class="${pct > 100 ? 'expense' : 'muted'}">${fmt(s)} of ${fmt(limit)}${pct > 100 ? ' · over budget' : ''}</span></div>
      <div class="bar"><i class="${pct > 100 ? 'over' : pct > 80 ? 'warn' : ''}" data-w="${Math.min(100, pct).toFixed(1)}"></i></div></div>`;
  }).join('')}</section>`;
}

/* ================= transactions ================= */

function txTable(txs, withActions = false) {
  if (!txs.length) return '<p class="muted nodata">No transactions to show.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Account</th><th class="num">Amount</th>${withActions ? '<th></th>' : ''}</tr></thead><tbody>
    ${txs.map(t => {
      const sign = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : '';
      return `<tr>
        <td class="nowrap">${fmtDate(t.date)}</td>
        <td><b>${esc(t.type === 'transfer' ? 'Transfer' : t.category)}</b> <span class="tag ${t.type}">${t.type}</span>${t.note ? `<small>${esc(t.note)}</small>` : ''}</td>
        <td>${esc(accName(t.accountId))}${t.type === 'transfer' ? ' → ' + esc(accName(t.toAccountId)) : ''}</td>
        <td class="num ${t.type}">${sign}${fmt(t.amount)}</td>
        ${withActions ? `<td class="acts"><button class="btn small" data-act="edit-tx" data-id="${esc(t.id)}">Edit</button> <button class="btn small danger" data-act="del-tx" data-id="${esc(t.id)}">Delete</button></td>` : ''}
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function filteredTx() {
  const f = ui.filters, q = f.q.trim().toLowerCase();
  return sortedTx().filter(t =>
    (!f.type || t.type === f.type) &&
    (!f.account || t.accountId === f.account || t.toAccountId === f.account) &&
    (!f.category || t.category === f.category) &&
    inRange(t, f.from, f.to) &&
    (!q || [t.category, t.note, accName(t.accountId), String(t.amount)].some(v => String(v || '').toLowerCase().includes(q))));
}

function renderTransactions(view) {
  const f = ui.filters;
  const cats = [...new Set(state.transactions.map(t => t.category).filter(Boolean))].sort();
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;
  view.innerHTML = `
    <div class="row between">
      <div class="quick">
        <button class="btn expense" data-act="add-tx" data-type="expense">+ Expense</button>
        <button class="btn income" data-act="add-tx" data-type="income">+ Income</button>
        <button class="btn" data-act="add-tx" data-type="transfer">Transfer</button>
      </div>
      <button class="btn" data-act="export-csv">Export CSV</button>
    </div>
    <section class="card filters">
      <label>Search<input type="search" data-filter="q" value="${esc(f.q)}" placeholder="Note, category, amount…"></label>
      <label>Account<select data-filter="account">${opt('', 'All accounts', f.account)}${sortedAccounts().map(a => opt(a.id, a.name, f.account)).join('')}</select></label>
      <label>Type<select data-filter="type">${opt('', 'All types', f.type)}${opt('expense', 'Expense', f.type)}${opt('income', 'Income', f.type)}${opt('transfer', 'Transfer', f.type)}</select></label>
      <label>Category<select data-filter="category">${opt('', 'All categories', f.category)}${cats.map(c => opt(c, c, f.category)).join('')}</select></label>
      <label>From<input type="date" data-filter="from" value="${esc(f.from)}"></label>
      <label>To<input type="date" data-filter="to" value="${esc(f.to)}"></label>
      <button class="btn link" data-act="clear-filters">Clear</button>
    </section>
    <section class="card" id="txList"></section>`;
  renderTxList();
}

function renderTxList() {
  const el = $('#txList');
  if (!el) return;
  const txs = filteredTx();
  const sum = type => txs.reduce((s, t) => s + (t.type === type ? cents(t.amount) : 0), 0);
  el.innerHTML = `<p class="muted summary">${txs.length} transaction${txs.length === 1 ? '' : 's'} · income <b class="income">${fmtC(sum('income'))}</b> · expenses <b class="expense">${fmtC(sum('expense'))}</b></p>
    ${txTable(txs, true)}`;
}

function openTx(type = 'expense', existing = null) {
  if (!state.accounts.length) { toast('Add an account first.'); go('accounts'); return; }
  const draft = existing ? { ...existing } : {
    type, amount: '', date: today(), category: '', note: '', toAccountId: '',
    accountId: findAcc(ui.lastAccount) ? ui.lastAccount : (findAcc(ui.filters.account) ? ui.filters.account : sortedAccounts()[0].id),
  };
  const dlg = $('#dlg');
  const bal = balances();

  const draw = () => {
    const isTransfer = draft.type === 'transfer';
    const ranked = isTransfer ? [] : rankedCategories(draft.type);
    if (!isTransfer && !draft.category && ranked[0]?.n) draft.category = ranked[0].name; // preselect the most common
    const accOpts = cur => sortedAccounts().map(a => `<option value="${esc(a.id)}" ${a.id === cur ? 'selected' : ''}>${esc(a.name)} (${fmtC(bal.get(a.id))})</option>`).join('');
    dlg.innerHTML = `<form id="txForm" novalidate>
      <h2>${existing ? 'Edit' : 'Add'} transaction</h2>
      <div class="seg" role="group" aria-label="Type">
        ${['expense', 'income', 'transfer'].map(t => `<button type="button" data-type="${t}" class="${t === draft.type ? 'on ' + t : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <label>${isTransfer ? 'From account' : 'Account'}<select name="accountId">${accOpts(draft.accountId)}</select></label>
      ${isTransfer ? `<label>To account<select name="toAccountId"><option value="">Select…</option>${accOpts(draft.toAccountId)}</select></label>` : ''}
      <div class="two">
        <label>Amount<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" value="${esc(draft.amount)}" required></label>
        <label>Date<input name="date" type="date" value="${esc(draft.date)}" required></label>
      </div>
      ${isTransfer ? '' : `<label>Category<input name="category" list="catList" maxlength="40" value="${esc(draft.category)}" placeholder="Pick below or type a new one" autocomplete="off"></label>
        <datalist id="catList">${ranked.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
        <div class="chips"><span class="muted">Most used:</span>${ranked.slice(0, 6).map(c => `<button type="button" class="chip ${c.name === draft.category ? 'on' : ''}" data-cat="${esc(c.name)}">${esc(c.name)}${c.n ? ` <small>${c.n}</small>` : ''}</button>`).join('')}</div>`}
      <label>Note (optional)<input name="note" maxlength="200" value="${esc(draft.note)}"></label>
      <p class="err" role="alert"></p>
      <menu><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${existing ? 'Save changes' : 'Add ' + draft.type}</button></menu>
    </form>`;
    const form = $('#txForm');
    const read = () => { for (const [k, v] of new FormData(form)) draft[k] = v; };
    $$('.seg button', form).forEach(b => b.onclick = () => { read(); if (draft.type !== b.dataset.type) draft.category = ''; draft.type = b.dataset.type; draw(); });
    $$('.chip', form).forEach(b => b.onclick = () => { read(); draft.category = b.dataset.cat; draw(); });
    $('[data-close]', form).onclick = () => dlg.close();
    form.onsubmit = e => {
      e.preventDefault();
      read();
      const err = msg => { $('.err', form).textContent = msg; };
      const amount = Math.round(Number(draft.amount) * 100) / 100;
      if (!(amount > 0)) return err('Enter an amount greater than zero.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return err('Pick a date.');
      if (!findAcc(draft.accountId)) return err('Pick an account.');
      const tx = { type: draft.type, accountId: draft.accountId, amount, date: draft.date, note: draft.note.trim().slice(0, 200) };
      if (isTransfer) {
        if (!findAcc(draft.toAccountId)) return err('Pick the account to transfer to.');
        if (draft.toAccountId === draft.accountId) return err('Pick two different accounts.');
        tx.toAccountId = draft.toAccountId;
        tx.category = 'Transfer';
      } else {
        tx.category = draft.category.trim().slice(0, 40) || 'Other';
      }
      if (existing) { tx.id = existing.id; tx.createdAt = existing.createdAt; }
      ui.lastAccount = tx.accountId;
      store.saveTransaction(tx);
      dlg.close();
      toast(existing ? 'Transaction updated.' : `${draft.type[0].toUpperCase() + draft.type.slice(1)} added.`);
    };
  };
  draw();
  dlg.showModal();
}

async function deleteTx(id) {
  const t = findTx(id);
  if (!t) return;
  const bal = balances(), c = cents(t.amount);
  const line = (accId, delta) => findAcc(accId)
    ? `<li><b>${esc(accName(accId))}</b> balance goes ${delta > 0 ? 'up' : 'down'} by ${fmtC(Math.abs(delta))}: ${fmtC(bal.get(accId))} → ${fmtC(bal.get(accId) + delta)}</li>` : '';
  const effects = t.type === 'income' ? line(t.accountId, -c)
    : t.type === 'expense' ? line(t.accountId, c)
    : line(t.accountId, c) + line(t.toAccountId, -c);
  const ok = await confirmDlg({
    title: `Delete this ${t.type}?`,
    body: `<p>${esc(t.type === 'transfer' ? 'Transfer' : t.category)} · ${fmt(t.amount)} · ${fmtDate(t.date)}</p><ul>${effects}</ul>`,
    confirm: 'Delete',
  });
  if (!ok) return;
  store.deleteTransaction(id);
  toast('Transaction deleted. Balance updated.');
}

/* ================= accounts ================= */

function renderAccounts(view) {
  const bal = balances();
  const count = id => state.transactions.filter(t => t.accountId === id || t.toAccountId === id).length;
  view.innerHTML = `
    <div class="row between"><h2>Accounts</h2><button class="btn primary" data-act="add-acc">+ Add account</button></div>
    ${state.accounts.length ? `<section class="acc-grid">${sortedAccounts().map(a => `
      <div class="card acc">
        <div class="row between"><b>${esc(a.name)}</b><span class="tag">${esc(a.type)}</span></div>
        <div class="bal ${bal.get(a.id) < 0 ? 'expense' : ''}">${fmtC(bal.get(a.id))}</div>
        <small class="muted">Opening ${fmt(a.openingBalance || 0)} · ${count(a.id)} transaction${count(a.id) === 1 ? '' : 's'}</small>
        <div class="acts">
          <button class="btn small" data-act="view-acc" data-id="${esc(a.id)}">Transactions</button>
          <button class="btn small" data-act="edit-acc" data-id="${esc(a.id)}">Edit</button>
          <button class="btn small danger" data-act="del-acc" data-id="${esc(a.id)}">Delete</button>
        </div>
      </div>`).join('')}</section>`
      : '<section class="card empty"><p class="muted">No accounts yet. Add one to start tracking.</p></section>'}`;
}

function openAccount(existing = null) {
  const dlg = $('#dlg');
  const a = existing || { name: '', type: 'Bank', openingBalance: '' };
  dlg.innerHTML = `<form id="accForm" novalidate>
    <h2>${existing ? 'Edit' : 'Add'} account</h2>
    <label>Name<input name="name" maxlength="40" value="${esc(a.name)}" placeholder="e.g. HDFC Savings" required></label>
    <label>Type<select name="type">${ACCOUNT_TYPES.map(t => `<option ${t === a.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Opening balance<input name="openingBalance" type="number" inputmode="decimal" step="0.01" value="${esc(a.openingBalance)}" placeholder="0.00"></label>
    <p class="muted small">The balance you have in this account today, before recording anything here. Use a negative number for money owed (e.g. a credit card).</p>
    <p class="err" role="alert"></p>
    <menu><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">${existing ? 'Save changes' : 'Add account'}</button></menu>
  </form>`;
  const form = $('#accForm');
  $('[data-close]', form).onclick = () => dlg.close();
  form.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const name = d.name.trim();
    const err = msg => { $('.err', form).textContent = msg; };
    if (!name) return err('Give the account a name.');
    if (state.accounts.some(x => x.id !== existing?.id && x.name.toLowerCase() === name.toLowerCase())) return err('You already have an account with that name.');
    const openingBalance = Math.round((Number(d.openingBalance) || 0) * 100) / 100;
    store.saveAccount({ ...(existing ? { id: existing.id, createdAt: existing.createdAt } : {}), name, type: d.type, openingBalance });
    dlg.close();
    toast(existing ? 'Account updated.' : 'Account added.');
  };
  dlg.showModal();
}

async function deleteAccount(id) {
  const a = findAcc(id);
  if (!a) return;
  const linked = state.transactions.filter(t => t.accountId === id || t.toAccountId === id);
  const transfers = linked.filter(t => t.type === 'transfer').length;
  const ok = await confirmDlg({
    title: `Delete "${a.name}"?`,
    body: `<p>${linked.length
      ? `This also permanently deletes its <b>${linked.length} transaction${linked.length === 1 ? '' : 's'}</b>.`
      : 'This account has no transactions.'}
      ${transfers ? ` ${transfers} of them ${transfers === 1 ? 'is a transfer' : 'are transfers'}, so the other account's balance will change too.` : ''}</p>
      <p class="muted">This cannot be undone. Export a backup from Settings first if you might need the history.</p>`,
    confirm: 'Delete account',
  });
  if (!ok) return;
  store.deleteAccount(id);
  if (ui.filters.account === id) ui.filters.account = '';
  toast(`Account deleted${linked.length ? ` with ${linked.length} transaction${linked.length === 1 ? '' : 's'}` : ''}.`);
}

/* ================= settings ================= */

function renderSettings(view) {
  const s = state.settings;
  const budgets = Object.entries(s.budgets || {});
  const cats = rankedCategories('expense').map(c => c.name);
  view.innerHTML = `
    <h2>Settings</h2>
    <section class="card form-card">
      <h3>Preferences</h3>
      <label>Currency<select data-setting="currency">${CURRENCIES.map(c => `<option ${c === s.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
      ${state.user.local ? '' : `<label>Sign out automatically after inactivity
        <select data-setting="autoLockMinutes">${[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [0, 'Never']].map(([v, l]) => `<option value="${v}" ${Number(s.autoLockMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
    </section>
    <section class="card form-card">
      <h3>Monthly budgets</h3>
      <p class="muted small">Set a monthly spending limit for a category. Progress shows on the dashboard.</p>
      ${budgets.map(([c, v]) => `<div class="row between line"><span>${esc(c)} · ${fmt(v)}</span><button class="btn small danger" data-act="del-budget" data-cat="${esc(c)}">Remove</button></div>`).join('')}
      <form id="budgetForm" class="two" novalidate>
        <label>Category<select name="cat">${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Monthly limit<input name="limit" type="number" step="0.01" min="0.01" inputmode="decimal"></label>
        <button class="btn" type="submit">Set budget</button>
      </form>
    </section>
    <section class="card form-card">
      <h3>Backup</h3>
      <p class="muted small">Download a full copy of your data now and then. A backup file is not encrypted, so keep it somewhere safe.</p>
      <div class="quick">
        <button class="btn" data-act="export-json">Download backup (JSON)</button>
        <button class="btn" data-act="export-csv">Export transactions (CSV)</button>
        <button class="btn danger" data-act="import-json">Restore from backup…</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </section>
    <section class="card form-card">
      <h3>Security</h3>
      <p class="muted small">${state.user.local
        ? 'Local mode has no login. Anyone using this browser profile can open the app. Set up Firebase (see README) to protect your data.'
        : `Signed in as ${esc(state.user.email)}. Data is stored in your own Firebase project and readable only by your login. Signing out also clears the offline copy from this device.`}</p>
      ${state.user.local ? '' : '<button class="btn" data-act="signout">Sign out</button>'}
    </section>`;

  $('#budgetForm').onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    const limit = Math.round(Number(d.limit) * 100) / 100;
    if (!(limit > 0)) return toast('Enter a monthly limit greater than zero.');
    store.saveSettings({ budgets: { ...(s.budgets || {}), [d.cat]: limit } });
  };
  $('#importFile').onchange = e => importBackup(e.target.files[0]);
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportCsv() {
  // Prefix cells that a spreadsheet could read as a formula.
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const txs = ui.view === 'transactions' ? filteredTx() : sortedTx();
  const rows = [['Date', 'Type', 'Account', 'To account', 'Category', 'Amount', 'Note'],
    ...txs.map(t => [t.date, t.type, accName(t.accountId), t.type === 'transfer' ? accName(t.toAccountId) : '', t.category, t.amount, t.note || ''])];
  download(`transactions-${today()}.csv`, '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'text/csv');
}

function exportJson() {
  download(`accounts-backup-${today()}.json`, JSON.stringify({
    app: 'account-management-system', version: 1, exportedAt: new Date().toISOString(),
    accounts: state.accounts, transactions: state.transactions, settings: state.settings,
  }, null, 2), 'application/json');
}

async function importBackup(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data.accounts) || !Array.isArray(data.transactions)) throw new Error('bad shape');
  } catch {
    return toast('That file is not a valid backup.');
  }
  const str = (v, n) => String(v ?? '').slice(0, n);
  const num = v => Math.round((Number(v) || 0) * 100) / 100;
  const idOk = v => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
  const accounts = data.accounts.filter(a => a && idOk(a.id) && a.name).map(a => ({
    id: a.id, name: str(a.name, 40), type: ACCOUNT_TYPES.includes(a.type) ? a.type : 'Other',
    openingBalance: num(a.openingBalance), createdAt: Number(a.createdAt) || Date.now(),
  }));
  const ids = new Set(accounts.map(a => a.id));
  const transactions = data.transactions.filter(t => t && idOk(t.id) && ['income', 'expense', 'transfer'].includes(t.type)
    && ids.has(t.accountId) && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && num(t.amount) > 0
    && (t.type !== 'transfer' || (ids.has(t.toAccountId) && t.toAccountId !== t.accountId))).map(t => ({
    id: t.id, type: t.type, accountId: t.accountId, ...(t.type === 'transfer' ? { toAccountId: t.toAccountId } : {}),
    amount: num(t.amount), date: t.date, category: str(t.category, 40) || 'Other', note: str(t.note, 200),
    createdAt: Number(t.createdAt) || Date.now(),
  }));
  const b = data.settings?.budgets, budgets = {};
  if (b && typeof b === 'object') for (const [k, v] of Object.entries(b)) if (num(v) > 0) budgets[str(k, 40)] = num(v);
  const settings = {
    currency: CURRENCIES.includes(data.settings?.currency) ? data.settings.currency : state.settings.currency,
    autoLockMinutes: Number(data.settings?.autoLockMinutes ?? state.settings.autoLockMinutes) || 0,
    budgets,
  };
  const ok = await confirmDlg({
    title: 'Restore this backup?',
    body: `<p>The file contains <b>${accounts.length}</b> account${accounts.length === 1 ? '' : 's'} and <b>${transactions.length}</b> transaction${transactions.length === 1 ? '' : 's'}.</p>
      <p>Everything currently in the app (${state.accounts.length} accounts, ${state.transactions.length} transactions) will be <b>replaced</b>.</p>`,
    confirm: 'Replace my data',
  });
  $('#importFile').value = '';
  if (!ok) return;
  store.replaceAll({ accounts, transactions, settings });
  toast('Backup restored.');
}

/* ================= dialogs ================= */

function confirmDlg({ title, body, confirm }) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" id="confirmForm"><h2>${esc(title)}</h2><div class="confirm-body">${body}</div>
    <menu><button type="button" class="btn" data-close>Cancel</button><button type="button" class="btn danger solid" data-ok>${esc(confirm)}</button></menu></form>`;
  return new Promise(resolve => {
    let result = false;
    $('[data-close]', dlg).onclick = () => dlg.close();
    $('[data-ok]', dlg).onclick = () => { result = true; dlg.close(); };
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
  });
}

/* ================= events ================= */

const actions = {
  nav: el => go(el.dataset.view),
  'add-tx': el => openTx(el.dataset.type),
  'edit-tx': el => { const t = findTx(el.dataset.id); if (t) openTx(t.type, t); },
  'del-tx': el => deleteTx(el.dataset.id),
  'add-acc': () => openAccount(),
  'edit-acc': el => openAccount(findAcc(el.dataset.id)),
  'del-acc': el => deleteAccount(el.dataset.id),
  'view-acc': el => { ui.filters = { q: '', type: '', account: el.dataset.id, category: '', from: '', to: '' }; go('transactions'); },
  'clear-filters': () => { ui.filters = { q: '', type: '', account: '', category: '', from: '', to: '' }; render(); },
  'export-csv': exportCsv,
  'export-json': exportJson,
  'import-json': () => $('#importFile').click(),
  'del-budget': el => { const b = { ...(state.settings.budgets || {}) }; delete b[el.dataset.cat]; store.saveSettings({ budgets: b }); },
  signout: () => store.signOut(),
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
});
document.addEventListener('input', e => {
  const key = e.target.dataset?.filter;
  if (key) { ui.filters[key] = e.target.value; renderTxList(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset?.ui === 'period') { ui.period = t.value; render(); }
  if (t.dataset?.setting) store.saveSettings({ [t.dataset.setting]: t.dataset.setting === 'autoLockMinutes' ? Number(t.value) : t.value });
});

/* ---- login ---- */
const AUTH_ERRORS = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/too-many-requests': 'Too many failed attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/user-disabled': 'This login has been disabled.',
};
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target, btn = $('button[type=submit]', f), err = $('#loginErr');
  err.textContent = '';
  btn.disabled = true;
  try {
    await store.signIn(f.email.value.trim(), f.password.value, f.remember.checked);
    f.password.value = '';
  } catch (ex) {
    err.textContent = AUTH_ERRORS[ex?.code] || 'Could not sign in. Please try again.';
  } finally {
    btn.disabled = false;
  }
};
$('#forgot').onclick = async () => {
  const email = $('#loginForm').email.value.trim(), err = $('#loginErr');
  if (!email) { err.textContent = 'Type your email above first, then press "Forgot password?".'; return; }
  try { await store.resetPassword(email); } catch { /* do not reveal whether the email exists */ }
  err.textContent = 'If that email has a login here, a password reset link is on its way.';
};

/* ---- auto sign-out after inactivity ---- */
let lastActive = Date.now();
['pointerdown', 'keydown', 'scroll'].forEach(ev => addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  const mins = Number(state.settings.autoLockMinutes);
  if (store.cloudMode && state.user && mins > 0 && Date.now() - lastActive > mins * 60000) store.signOut();
}, 15000);

/* ================= start ================= */

store.onNotice(toast);
store.subscribe(() => {
  // Re-rendering while a dialog is open is fine: dialogs live outside #view.
  render();
});
store.init().catch(e => {
  console.error(e);
  $('#boot').innerHTML = '<p class="err">The app could not start. Check js/firebase-config.js and reload.</p>';
});
