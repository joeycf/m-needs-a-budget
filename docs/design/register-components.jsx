// register-components.jsx — account register pieces (Checking)
// Needs: budget-components.jsx (fmtMoney, MiniSelect, initialGroups), shell-components.jsx
// Exports to window: seedTransactions, payeeDefaults, registerCategories,
//   BalanceHeader, RegisterToolbar, AddTransactionRow, RegisterTable

const payeeDefaults = {
  "Trader Joe's": "Groceries",
  "Shell": "Transport",
  "Comcast": "Internet",
  "PG&E": "Electric",
  "La Taqueria": "Dining out",
  "Spotify": "Subscriptions",
  "Landlord": "Rent",
  "Acme Payroll": "Ready to Assign",
  "Walgreens": "Medical",
  "Venmo from Sam": "Ready to Assign",
};

const registerCategories = ["Ready to Assign"].concat(
  initialGroups.flatMap((g) => g.cats.map((c) => c.name))
);

// outflow negative, inflow positive
const seedTransactions = [
  { id: 1,  date: "06/11/2026", payee: "Shell",          category: "Transport",       memo: "",            amount: -42.07,   cleared: false },
  { id: 2,  date: "06/11/2026", payee: "Venmo from Sam", category: "Ready to Assign", memo: "dinner split", amount: 230.19,  cleared: false },
  { id: 3,  date: "06/10/2026", payee: "Trader Joe's",   category: "Groceries",       memo: "weekly run",  amount: -84.12,   cleared: true },
  { id: 4,  date: "06/09/2026", payee: "Acme Payroll",   category: "Ready to Assign", memo: "",            amount: 3500.00,  cleared: true },
  { id: 5,  date: "06/08/2026", payee: "Comcast",        category: "Internet",        memo: "",            amount: -70.00,   cleared: true },
  { id: 6,  date: "06/07/2026", payee: "La Taqueria",    category: "Dining out",      memo: "",            amount: -38.50,   cleared: true },
  { id: 7,  date: "06/06/2026", payee: "PG&E",           category: "Electric",        memo: "",            amount: -96.40,   cleared: true },
  { id: 8,  date: "06/05/2026", payee: "Trader Joe's",   category: "Groceries",       memo: "",            amount: -112.88,  cleared: true },
  { id: 9,  date: "06/03/2026", payee: "Transfer : Savings", category: "—",           memo: "monthly sweep", amount: -500.00, cleared: true },
  { id: 10, date: "06/02/2026", payee: "Spotify",        category: "Subscriptions",   memo: "",            amount: -11.99,   cleared: true },
  { id: 11, date: "06/01/2026", payee: "Landlord",       category: "Rent",            memo: "june",        amount: -1800.00, cleared: true },
  { id: 12, date: "05/30/2026", payee: "Walgreens",      category: "Medical",         memo: "",            amount: -20.00,   cleared: true },
];

// Constant so the seed data lands on Cleared $4,624.21 / Working $4,812.33
const STARTING_CLEARED = 3858.10;

function registerBalances(txns) {
  let cleared = STARTING_CLEARED, uncleared = 0;
  txns.forEach((t) => { if (t.cleared) cleared += t.amount; else uncleared += t.amount; });
  return { cleared, uncleared, working: cleared + uncleared };
}

/* ---------------- Header: balances + reconcile ---------------- */

function BalanceFig({ label, value, strong }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="num" style={{ fontSize: strong ? 18 : 16, fontWeight: strong ? 700 : 600, color: value < -0.004 ? "var(--cash-overspent-fg)" : "var(--text-primary)" }}>{fmtMoney(value)}</div>
      <div className="th-caps" style={{ marginTop: 1 }}>{label}</div>
    </div>
  );
}

function BalanceHeader({ txns, accountName }) {
  const b = registerBalances(txns);
  const op = { color: "var(--text-muted)", fontSize: 14, paddingBottom: 14 };
  return (
    <div style={{
      background: "var(--bg-surface)", borderBottom: "1px solid var(--border-default)",
      padding: "14px 24px", display: "flex", alignItems: "center", gap: 24,
    }}>
      <div style={{ fontSize: "var(--text-xl)", fontWeight: 700, flex: 1 }}>{accountName}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
        <BalanceFig label="Cleared" value={b.cleared} />
        <span style={op}>+</span>
        <BalanceFig label="Uncleared" value={b.uncleared} />
        <span style={op}>=</span>
        <BalanceFig label="Working balance" value={b.working} strong />
      </div>
      <button className="btn btn-secondary">Reconcile</button>
    </div>
  );
}

/* ---------------- Toolbar: search + filter chips ---------------- */

function FilterChip({ label, active, onClick, caret }) {
  return (
    <button onClick={onClick} style={{
      height: 24, display: "inline-flex", alignItems: "center", gap: 5,
      padding: "0 10px", borderRadius: "var(--radius-pill)",
      fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500, cursor: "pointer",
      background: active ? "var(--teal-50)" : "var(--bg-surface)",
      color: active ? "var(--teal-800)" : "var(--text-secondary)",
      border: "1px solid " + (active ? "var(--teal-300)" : "var(--border-strong)"),
    }}>
      {label}{caret ? <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span> : null}
    </button>
  );
}

function RegisterToolbar({ search, setSearch, unclearedOnly, setUnclearedOnly, count }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px 0" }}>
      <input className="input" placeholder="Search transactions…" value={search}
        onChange={(e) => setSearch(e.target.value)} style={{ width: 230 }} />
      <FilterChip label="Date: this month" caret />
      <FilterChip label="Category" caret />
      <FilterChip label="Payee" caret />
      <FilterChip label="Uncleared" active={unclearedOnly} onClick={() => setUnclearedOnly(!unclearedOnly)} />
      <div style={{ flex: 1 }}></div>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{count} transactions</span>
    </div>
  );
}

/* ---------------- Add-transaction row ---------------- */

const cellInputStyle = {
  width: "100%", boxSizing: "border-box", height: 24, padding: "0 4px",
  font: "inherit", fontSize: 13, border: "1px solid var(--border-strong)",
  borderRadius: 2, background: "var(--bg-surface)",
};

function AddTransactionRow({ onSave, memoCol }) {
  const empty = { date: "06/11/2026", payee: "", category: "", memo: "", outflow: "", inflow: "" };
  const [row, setRow] = React.useState(empty);
  const [payeeOpen, setPayeeOpen] = React.useState(false);
  const set = (k, v) => setRow((r) => ({ ...r, [k]: v }));

  const suggestions = Object.keys(payeeDefaults).filter(
    (p) => row.payee && p.toLowerCase().includes(row.payee.toLowerCase()) && p.toLowerCase() !== row.payee.toLowerCase()
  );

  const pickPayee = (p) => {
    setRow((r) => ({ ...r, payee: p, category: r.category || payeeDefaults[p] || "" }));
    setPayeeOpen(false);
  };

  const save = () => {
    const out = parseFloat(String(row.outflow).replace(/[$,\s]/g, ""));
    const inf = parseFloat(String(row.inflow).replace(/[$,\s]/g, ""));
    const amount = !isNaN(inf) && inf > 0 ? inf : !isNaN(out) && out > 0 ? -out : 0;
    if (!row.payee || amount === 0) return;
    onSave({ date: row.date, payee: row.payee, category: row.category || "Ready to Assign", memo: row.memo, amount: amount, cleared: false });
    setRow(empty);
    setPayeeOpen(false);
  };
  const cancel = () => { setRow(empty); setPayeeOpen(false); };

  const onKey = (e) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  };

  const catOptions = registerCategories.map((c) => ({ id: c, label: c }));

  return (
    <React.Fragment>
      <tr style={{ background: "var(--teal-50)" }} onKeyDown={onKey}>
        <td style={{ width: 100 }}><input style={cellInputStyle} value={row.date} onChange={(e) => set("date", e.target.value)} aria-label="Date" /></td>
        <td style={{ position: "relative" }}>
          <input style={cellInputStyle} placeholder="Payee" value={row.payee}
            onChange={(e) => { set("payee", e.target.value); setPayeeOpen(true); }}
            onBlur={() => setTimeout(() => setPayeeOpen(false), 150)} />
          {payeeOpen && suggestions.length > 0 ? (
            <div className="menu" style={{ position: "absolute", top: "calc(100% - 4px)", left: 8, zIndex: 70, width: 220 }}>
              {suggestions.map((p) => (
                <div key={p} className="menu-item" onMouseDown={() => pickPayee(p)}>
                  <span>{p}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{payeeDefaults[p]}</span>
                </div>
              ))}
            </div>
          ) : null}
        </td>
        <td style={{ width: 160 }}>
          <MiniSelect value={row.category || null} options={catOptions} onChange={(v) => set("category", v)} />
        </td>
        {memoCol ? <td><input style={cellInputStyle} placeholder="Memo" value={row.memo} onChange={(e) => set("memo", e.target.value)} /></td> : null}
        <td style={{ width: 110 }}><input style={{ ...cellInputStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} placeholder="Outflow" value={row.outflow} onChange={(e) => set("outflow", e.target.value)} /></td>
        <td style={{ width: 110 }}><input style={{ ...cellInputStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }} placeholder="Inflow" value={row.inflow} onChange={(e) => set("inflow", e.target.value)} /></td>
        <td style={{ width: 44, textAlign: "center" }}><span className="uncleared-check">✓</span></td>
      </tr>
      <tr style={{ background: "var(--teal-50)" }}>
        <td colSpan={memoCol ? 7 : 6} style={{ height: 30, padding: "2px 8px 8px" }}>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>Enter saves · Esc cancels · payee fills its last category</span>
            <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        </td>
      </tr>
    </React.Fragment>
  );
}

/* ---------------- Register table ---------------- */

function RegisterTable({ txns, onToggleCleared, onSave, memoCol }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", overflow: "visible", background: "var(--bg-surface)", boxShadow: "var(--shadow-sm)" }}>
      <table className="mnab-table">
        <thead>
          <tr>
            <th style={{ width: 100 }}>Date</th>
            <th>Payee</th>
            <th style={{ width: 160 }}>Category</th>
            {memoCol ? <th>Memo</th> : null}
            <th className="num" style={{ width: 110 }}>Outflow</th>
            <th className="num" style={{ width: 110 }}>Inflow</th>
            <th style={{ width: 44, textAlign: "center" }}>✓</th>
          </tr>
        </thead>
        <tbody>
          <AddTransactionRow onSave={onSave} memoCol={memoCol} />
          {txns.map((t) => (
            <tr key={t.id}>
              <td className="num" style={{ textAlign: "left" }}>{t.date}</td>
              <td>{t.payee}</td>
              <td style={{ color: t.category === "—" ? "var(--text-muted)" : "var(--text-primary)" }}>{t.category}</td>
              {memoCol ? <td style={{ color: "var(--text-secondary)" }}>{t.memo}</td> : null}
              <td className="num">{t.amount < 0 ? fmtMoney(-t.amount) : ""}</td>
              <td className="num amount-inflow">{t.amount > 0 ? fmtMoney(t.amount) : ""}</td>
              <td style={{ textAlign: "center" }}>
                <span className={t.cleared ? "cleared-check" : "uncleared-check"} onClick={() => onToggleCleared(t.id)} title={t.cleared ? "Cleared" : "Uncleared"}>✓</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

Object.assign(window, {
  seedTransactions, payeeDefaults, registerCategories, registerBalances,
  BalanceHeader, RegisterToolbar, AddTransactionRow, RegisterTable, FilterChip,
});
