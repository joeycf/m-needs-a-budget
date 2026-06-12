// budget-components.jsx — Budget screen pieces
// Exports to window: initialGroups, fmtMoney, catAvailable, pillStateOf,
//   MonthSwitcher, RtaBanner, MoveMoneyPopover, BudgetTable

const initialGroups = [
  { id: "imm", name: "Immediate obligations", cats: [
    { id: "rent",  name: "Rent",            assigned: 1800, activity: -1800,   carry: 0, target: 1800 },
    { id: "groc",  name: "Groceries",       assigned: 600,  activity: -355,    carry: 0, target: 600 },
    { id: "elec",  name: "Electric",        assigned: 120,  activity: -96.40,  carry: 0, target: 120 },
    { id: "net",   name: "Internet",        assigned: 70,   activity: -70,     carry: 0, target: 70 },
    { id: "trans", name: "Transport",       assigned: 80,   activity: -192.19, carry: 0, target: 150 },
  ]},
  { id: "true", name: "True expenses", cats: [
    { id: "car",  name: "Car maintenance",  assigned: 50,  activity: 0,    carry: 300 },
    { id: "med",  name: "Medical",          assigned: 75,  activity: -20,  carry: 0, target: 100 },
    { id: "ins",  name: "Insurance",        assigned: 110, activity: 0,    carry: 0, target: 110 },
    { id: "gift", name: "Gifts",            assigned: 0,   activity: 0,    carry: 0, target: 50 },
  ]},
  { id: "qol", name: "Quality of life", cats: [
    { id: "dine", name: "Dining out",       assigned: 150, activity: -188.50, carry: 0, credit: true },
    { id: "fun",  name: "Fun money",        assigned: 100, activity: -42.30,  carry: 0 },
    { id: "subs", name: "Subscriptions",    assigned: 45,  activity: -45,     carry: 0, target: 45 },
  ]},
  { id: "save", name: "Savings goals", startCollapsed: true, cats: [
    { id: "emer", name: "Emergency fund",   assigned: 500, activity: 0, carry: 1500, target: 1000 },
    { id: "vac",  name: "Vacation",         assigned: 300, activity: 0, carry: 100, target: 300 },
  ]},
];

function fmtMoney(n) {
  const sign = n < -0.004 ? "\u2212" : "";
  const abs = Math.abs(n);
  return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function catAvailable(c) { return c.assigned + c.activity + c.carry; }

function pillStateOf(c) {
  const av = catAvailable(c);
  if (av > 0.004) return "funded";
  if (av < -0.004) return c.credit ? "credit" : "cash";
  return "zero";
}

/* ---------------- Target progress ---------------- */
// assigned-this-month ÷ monthly target. Three states:
// funded (assigned ≥ target, green) · partial (teal) · untouched (assigned = 0, gray)

function TargetProgress({ cat }) {
  if (!cat.target) return null;
  const ratio = Math.max(0, Math.min(1, cat.assigned / cat.target));
  const funded = cat.assigned >= cat.target - 0.004;
  const untouched = cat.assigned <= 0.004;
  const fill = funded ? "var(--funded-strong)" : "var(--accent)";
  const label = funded ? "Funded" : fmtMoney(cat.target - cat.assigned) + " more needed";
  const labelColor = funded ? "var(--funded-fg)" : untouched ? "var(--text-muted)" : "var(--text-secondary)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, maxWidth: 320 }}>
      <div style={{ flex: 1, height: 3, borderRadius: 2, background: "var(--gray-200)", overflow: "hidden" }}>
        {untouched ? null : <div style={{ width: (ratio * 100) + "%", height: "100%", borderRadius: 2, background: fill }}></div>}
      </div>
      <span className="num" style={{ fontSize: 10, fontWeight: 500, color: labelColor, flexShrink: 0, whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

/* ---------------- Month switcher ---------------- */

function MonthSwitcher({ month, onPrev, onNext }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button className="btn btn-ghost" style={{ width: 28, padding: 0, fontSize: 16 }} onClick={onPrev} aria-label="Previous month">‹</button>
      <div style={{ fontSize: "var(--text-xl)", fontWeight: 700, minWidth: 150, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{month}</div>
      <button className="btn btn-ghost" style={{ width: 28, padding: 0, fontSize: 16 }} onClick={onNext} aria-label="Next month">›</button>
    </div>
  );
}

/* ---------------- RTA banner + assign popover (Manually / Auto) ---------------- */

function stateOfAmount(av, credit) {
  if (av > 0.004) return "funded";
  if (av < -0.004) return credit ? "credit" : "cash";
  return "zero";
}

function MiniPill({ value, credit }) {
  const cls = { funded: "pill--funded", credit: "pill--credit", cash: "pill--cash", zero: "pill--zero" }[stateOfAmount(value, credit)];
  return <span className={"pill " + cls} style={{ minWidth: 0, height: 18, fontSize: 11, padding: "0 7px", flexShrink: 0 }}>{fmtMoney(value)}</span>;
}

function GroupedToSelect({ value, groups, onChange }) {
  const [open, setOpen] = React.useState(false);
  let current = null;
  groups.forEach((g) => g.cats.forEach((c) => { if (c.id === value) current = c; }));
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{
        height: "var(--control-h)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "0 8px", fontSize: 13, cursor: "pointer",
        background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: current ? "var(--text-primary)" : "var(--text-muted)" }}>{current ? current.name : "Select category\u2026"}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>▾</span>
      </div>
      {open ? (
        <div className="menu" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 80, maxHeight: 240, overflowY: "auto", minWidth: 0 }}>
          {groups.map((g) => (
            <div key={g.id}>
              <div style={{ padding: "6px 8px 2px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-muted)" }}>{g.name}</div>
              {g.cats.map((c) => (
                <div key={c.id} className="menu-item" onClick={() => { onChange(c.id); setOpen(false); }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <MiniPill value={catAvailable(c)} credit={c.credit} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AssignPopover({ rta, underfunded, groups, onAuto, onAssignManual, onClose, staticPos, defaultTab }) {
  const [tab, setTab] = React.useState(defaultTab || "manually");
  const [amount, setAmount] = React.useState(Math.max(0, rta).toFixed(2));
  const [to, setTo] = React.useState(null);
  const fieldLabel = { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-secondary)", marginBottom: 4 };
  const posStyle = staticPos ? { position: "relative" } : { position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 60 };
  const parsed = parseFloat(String(amount).replace(/[$,\s]/g, "")) || 0;

  const autoRows = [
    { key: "underfunded", label: "Underfunded", amount: underfunded > 0.004 ? fmtMoney(underfunded) : null },
    { key: "lastAssigned", label: "Assigned last month", amount: "$2,915.00" },
    { key: "lastSpent", label: "Spent last month", amount: "$2,704.12" },
    { key: "reset", label: "Reset to $0.00", amount: null },
  ];

  const tabStyle = (active) => ({
    flex: 1, textAlign: "center", padding: "7px 0", fontSize: 13, fontWeight: active ? 600 : 500, cursor: "pointer",
    color: active ? "var(--teal-800)" : "var(--text-secondary)",
    borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
  });

  return (
    <div className="card" style={{ ...posStyle, width: 280, padding: 0, boxShadow: "var(--shadow-menu)", textAlign: "left", cursor: "default", color: "var(--text-primary)" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-default)" }}>
        <div style={tabStyle(tab === "manually")} onClick={() => setTab("manually")}>Manually</div>
        <div style={tabStyle(tab === "auto")} onClick={() => setTab("auto")}>Auto</div>
      </div>

      {tab === "manually" ? (
        <div style={{ padding: 14 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={fieldLabel}>Amount</div>
            <input className="input num" style={{ width: "100%", boxSizing: "border-box", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={fieldLabel}>To:</div>
            <GroupedToSelect value={to} groups={groups} onChange={setTo} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 1.6 }} disabled={!to || parsed <= 0}
              onClick={() => onAssignManual && onAssignManual(to, parsed)}>
              Assign {fmtMoney(parsed)}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 4 }}>
          {autoRows.map((r) => (
            <div key={r.key} className="menu-item" onClick={() => onAuto && onAuto(r.key)}>
              <span>{r.label}</span>
              {r.amount ? <span className="num" style={{ color: "var(--text-secondary)" }}>{r.amount}</span> : <span></span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RtaBanner({ amount, variant, menuOpen, onToggleMenu, onPick, onAssignManual, onCloseMenu, groups, underfunded, bar }) {
  const state = variant || (amount > 0.004 ? "positive" : amount < -0.004 ? "negative" : "zero");
  const cls = "rta-banner rta-banner--" + state;
  const label = state === "zero" ? "All money assigned" : "Ready to Assign";
  return (
    <div className={cls} style={{
      position: "relative",
      justifyContent: "space-between",
      width: bar ? "100%" : 320,
      boxSizing: "border-box",
    }}>
      <div>
        <div className="rta-amount num" style={{ textAlign: "left" }}>{fmtMoney(amount)}</div>
        <div className="rta-label">{label}</div>
      </div>
      {state !== "zero" ? (
        <button className="btn btn-secondary" onClick={onToggleMenu}>{state === "negative" ? "Fix" : "Assign"} ▾</button>
      ) : null}
      {menuOpen ? (
        <AssignPopover rta={amount} underfunded={underfunded} groups={groups || initialGroups}
          onAuto={onPick} onAssignManual={onAssignManual}
          onClose={onCloseMenu || onToggleMenu} />
      ) : null}
    </div>
  );
}

/* ---------------- Mini select ---------------- */

function MiniSelect({ value, options, onChange, fixed }) {
  const [open, setOpen] = React.useState(false);
  if (fixed) {
    return (
      <div style={{
        height: "var(--control-h)", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 8px", fontSize: 13, color: "var(--text-primary)",
        background: "var(--gray-100)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)",
      }}>
        <span>{value}</span>
      </div>
    );
  }
  const current = options.find((o) => o.id === value);
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => setOpen(!open)} style={{
        height: "var(--control-h)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        padding: "0 8px", fontSize: 13, cursor: "pointer",
        background: "var(--bg-surface)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
      }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current ? current.label : "Select category…"}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>▾</span>
      </div>
      {open ? (
        <div className="menu" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 80, maxHeight: 200, overflowY: "auto", minWidth: 0 }}>
          {options.map((o) => (
            <div key={o.id} className="menu-item" onClick={() => { onChange(o.id); setOpen(false); }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
              {o.amount != null ? <span className="num" style={{ color: "var(--text-secondary)", flexShrink: 0 }}>{fmtMoney(o.amount)}</span> : <span></span>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Move Money popover ---------------- */

// mode: "take" (clicked a funded pill) | "cover" (clicked an overspent pill)
function MoveMoneyPopover({ mode, cat, groups, rta, onMove, onClose, openUp, staticPos }) {
  const av = catAvailable(cat);
  const [amount, setAmount] = React.useState(Math.abs(av).toFixed(2));
  const flat = [];
  groups.forEach((g) => g.cats.forEach((c) => { if (c.id !== cat.id) flat.push(c); }));
  const fundedOptions = [{ id: "rta", label: "Ready to Assign", amount: rta }]
    .concat(flat.filter((c) => catAvailable(c) > 0.004).map((c) => ({ id: c.id, label: c.name, amount: catAvailable(c) })));
  const anyOptions = [{ id: "rta", label: "Ready to Assign", amount: rta }]
    .concat(flat.map((c) => ({ id: c.id, label: c.name, amount: catAvailable(c) })));
  const [other, setOther] = React.useState("rta");

  const title = mode === "cover" ? "Cover overspending" : "Move money";
  const fieldLabel = { fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-secondary)", marginBottom: 4 };

  const posStyle = staticPos ? { position: "relative" } : {
    position: "absolute", right: 0, zIndex: 70,
    ...(openUp ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
  };

  return (
    <div className="card" style={{ ...posStyle, width: 280, padding: 14, boxShadow: "var(--shadow-menu)", textAlign: "left", cursor: "default" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <button className="btn btn-ghost" style={{ width: 24, height: 24, padding: 0, fontSize: 13 }} onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>Amount</div>
        <input className="input num" style={{ width: "100%", boxSizing: "border-box", textAlign: "right", fontVariantNumeric: "tabular-nums" }}
          value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={fieldLabel}>From</div>
        {mode === "take"
          ? <MiniSelect fixed value={cat.name} />
          : <MiniSelect value={other} options={fundedOptions} onChange={setOther} />}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>To</div>
        {mode === "cover"
          ? <MiniSelect fixed value={cat.name} />
          : <MiniSelect value={other} options={anyOptions} onChange={setOther} />}
      </div>

      <button className="btn btn-primary" style={{ width: "100%" }}
        onClick={() => onMove && onMove(other, parseFloat(String(amount).replace(/[$,\s]/g, "")) || 0)}>
        Move {fmtMoney(parseFloat(String(amount).replace(/[$,\s]/g, "")) || 0)}
      </button>
    </div>
  );
}

/* ---------------- Budget table ---------------- */

function AssignedCell({ cat, onCommit, rowH }) {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState("");
  const start = () => { setVal(cat.assigned.toFixed(2)); setEditing(true); };
  const commit = () => {
    const n = parseFloat(String(val).replace(/[$,\s]/g, ""));
    if (!isNaN(n)) onCommit(n);
    setEditing(false);
  };
  return (
    <td className="num" style={{ width: 130, cursor: "text" }} onClick={() => !editing && start()}>
      {editing ? (
        <input className="input-cell" autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }} />
      ) : fmtMoney(cat.assigned)}
    </td>
  );
}

function CategoryRow({ cat, groups, rta, onAssign, onMove, popoverFor, setPopoverFor, openUp, showTargets }) {
  const av = catAvailable(cat);
  const state = pillStateOf(cat);
  const pillCls = { funded: "pill--funded", credit: "pill--credit", cash: "pill--cash", zero: "pill--zero" }[state];
  const open = popoverFor === cat.id;
  return (
    <tr>
      <td style={{ verticalAlign: "middle" }}>
        <div>{cat.name}</div>
        {showTargets ? <TargetProgress cat={cat} /> : null}
      </td>
      <AssignedCell cat={cat} onCommit={(n) => onAssign(cat.id, n)} />
      <td className="num" style={{ width: 130 }}>
        <span className="activity-link" style={{ color: "var(--text-secondary)", cursor: "pointer" }}>{cat.activity === 0 ? "$0.00" : fmtMoney(cat.activity)}</span>
      </td>
      <td className="num" style={{ width: 150 }}>
        <span style={{ position: "relative", display: "inline-block" }}>
          <span className={"pill " + pillCls} onClick={() => setPopoverFor(open ? null : cat.id)}>{fmtMoney(av)}</span>
          {open ? (
            <MoveMoneyPopover
              mode={state === "funded" ? "take" : "cover"}
              cat={cat} groups={groups} rta={rta}
              openUp={openUp}
              onClose={() => setPopoverFor(null)}
              onMove={(otherId, amt) => { onMove(cat.id, otherId, amt, state === "funded" ? "take" : "cover"); setPopoverFor(null); }} />
          ) : null}
        </span>
      </td>
    </tr>
  );
}

function BudgetTable({ groups, rta, collapsed, onToggleGroup, onAssign, onMove, popoverFor, setPopoverFor, showTargets }) {
  let rowIndex = 0;
  const totalRows = groups.reduce((acc, g) => acc + 1 + (collapsed[g.id] ? 0 : g.cats.length), 0);
  return (
    <div style={{ border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", overflow: "visible", background: "var(--bg-surface)", boxShadow: "var(--shadow-sm)" }}>
      <table className="mnab-table" style={{ borderRadius: "var(--radius-md)", overflow: "visible" }}>
        <thead>
          <tr>
            <th style={{ borderTopLeftRadius: "var(--radius-md)" }}>Category</th>
            <th className="num" style={{ width: 130 }}>Assigned</th>
            <th className="num" style={{ width: 130 }}>Activity</th>
            <th className="num" style={{ width: 150, borderTopRightRadius: "var(--radius-md)" }}>Available</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isCollapsed = !!collapsed[g.id];
            const sums = g.cats.reduce((acc, c) => ({
              assigned: acc.assigned + c.assigned,
              activity: acc.activity + c.activity,
              available: acc.available + catAvailable(c),
            }), { assigned: 0, activity: 0, available: 0 });
            rowIndex += 1;
            const groupRow = (
              <tr key={g.id} className="group-row" onClick={() => onToggleGroup(g.id)} style={{ cursor: "pointer" }}>
                <td><span style={{ display: "inline-block", width: 16, color: "var(--text-secondary)" }}>{isCollapsed ? "▸" : "▾"}</span>{g.name}</td>
                <td className="num">{fmtMoney(sums.assigned)}</td>
                <td className="num">{sums.activity === 0 ? "$0.00" : fmtMoney(sums.activity)}</td>
                <td className="num" style={{ paddingRight: 16 }}>{fmtMoney(sums.available)}</td>
              </tr>
            );
            const catRows = isCollapsed ? [] : g.cats.map((c) => {
              rowIndex += 1;
              const openUp = rowIndex > totalRows - 4;
              return <CategoryRow key={c.id} cat={c} groups={groups} rta={rta}
                onAssign={onAssign} onMove={onMove}
                popoverFor={popoverFor} setPopoverFor={setPopoverFor} openUp={openUp} showTargets={showTargets} />;
            });
            return [groupRow].concat(catRows);
          })}
        </tbody>
      </table>
    </div>
  );
}

Object.assign(window, {
  initialGroups, fmtMoney, catAvailable, pillStateOf, TargetProgress,
  MonthSwitcher, RtaBanner, AssignPopover, GroupedToSelect, MiniPill, MiniSelect, MoveMoneyPopover, BudgetTable,
});
