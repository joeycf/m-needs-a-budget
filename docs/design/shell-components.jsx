// shell-components.jsx — shared app shell pieces (sidebar, themes, account data)
// Exports to window: Sidebar, sidebarTheme, shellAccounts

function sidebarTheme(tone) {
  if (tone === "dark") {
    return {
      bg: "#0c423c",
      border: "rgba(255,255,255,0.10)",
      text: "rgba(255,255,255,0.92)",
      secondary: "rgba(255,255,255,0.55)",
      muted: "rgba(255,255,255,0.40)",
      neg: "#ffa399",
      hover: "rgba(255,255,255,0.07)",
      activeBg: "rgba(255,255,255,0.14)",
      activeText: "#ffffff",
      markBg: "#ffffff",
      markText: "#0c423c",
      btnBg: "transparent",
      btnBorder: "rgba(255,255,255,0.35)",
      btnText: "rgba(255,255,255,0.92)",
    };
  }
  return {
    bg: "var(--bg-surface)",
    border: "var(--border-default)",
    text: "var(--text-primary)",
    secondary: "var(--text-secondary)",
    muted: "var(--text-muted)",
    neg: "var(--cash-overspent-fg)",
    hover: "var(--gray-100)",
    activeBg: "var(--teal-50)",
    activeText: "var(--teal-800)",
    markBg: "var(--accent)",
    markText: "#ffffff",
    btnBg: "var(--bg-surface)",
    btnBorder: "var(--border-strong)",
    btnText: "var(--text-primary)",
  };
}

const shellAccounts = {
  budget: [
    { name: "Checking", balance: "$4,812.33", neg: false },
    { name: "Savings", balance: "$12,250.00", neg: false },
    { name: "Chase Sapphire", balance: "\u2212$638.50", neg: true },
  ],
  budgetTotal: "$16,423.83",
  tracking: [
    { name: "Brokerage", balance: "$48,920.11", neg: false },
    { name: "401(k)", balance: "$86,114.92", neg: false },
    { name: "Car loan", balance: "\u2212$11,438.27", neg: true },
  ],
  trackingTotal: "$123,596.76",
  netTotal: "$140,020.59",
};

function ShellNavItem({ label, active, theme, mobile }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center",
        height: mobile ? 44 : 30,
        padding: "0 10px",
        borderRadius: "var(--radius-sm)",
        fontSize: mobile ? 14 : 13,
        fontWeight: active ? 600 : 500,
        color: active ? theme.activeText : theme.text,
        background: active ? theme.activeBg : hover ? theme.hover : "transparent",
        cursor: "pointer",
      }}
    >{label}</div>
  );
}

function ShellAccountRow({ name, balance, neg, theme, mobile, active }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        height: mobile ? 40 : 28,
        padding: "0 10px",
        borderRadius: "var(--radius-sm)",
        background: active ? theme.activeBg : hover ? theme.hover : "transparent",
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? theme.activeText : theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      <span className="num" style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: neg ? theme.neg : active ? theme.activeText : theme.secondary, flexShrink: 0 }}>{balance}</span>
    </div>
  );
}

function ShellSectionHeading({ label, total, theme }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 10px", marginBottom: 2 }}>
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: theme.muted }}>{label}</span>
      <span className="num" style={{ fontSize: 11, color: theme.muted }}>{total}</span>
    </div>
  );
}

function Sidebar({ tone, mobile, width, activeNav, activeAccount }) {
  const theme = sidebarTheme(tone);
  const active = activeNav || "Budget";
  return (
    <div style={{
      width: width, flexShrink: 0, height: "100%", boxSizing: "border-box",
      background: theme.bg,
      borderRight: "1px solid " + theme.border,
      display: "flex", flexDirection: "column",
      padding: "12px 8px",
      fontFamily: "var(--font-ui)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 10px 12px" }}>
        <div style={{
          width: 24, height: 24, borderRadius: 5, background: theme.markBg, color: theme.markText,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}>M</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, whiteSpace: "nowrap" }}>M Needs a Budget</div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <ShellNavItem label="Budget" active={active === "Budget"} theme={theme} mobile={mobile} />
        <ShellNavItem label="Reports" active={active === "Reports"} theme={theme} mobile={mobile} />
        <ShellNavItem label="All Accounts" active={active === "All Accounts"} theme={theme} mobile={mobile} />
      </nav>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 1 }}>
        <ShellSectionHeading label="Budget" total={shellAccounts.budgetTotal} theme={theme} />
        {shellAccounts.budget.map((a) => <ShellAccountRow key={a.name} {...a} theme={theme} mobile={mobile} active={a.name === activeAccount} />)}
      </div>
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 1 }}>
        <ShellSectionHeading label="Tracking" total={shellAccounts.trackingTotal} theme={theme} />
        {shellAccounts.tracking.map((a) => <ShellAccountRow key={a.name} {...a} theme={theme} mobile={mobile} active={a.name === activeAccount} />)}
      </div>

      <div style={{ flex: 1 }}></div>

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderTop: "1px solid " + theme.border,
        margin: "0 2px", padding: "10px 8px 12px",
      }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: theme.secondary }}>Net total</span>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{shellAccounts.netTotal}</span>
      </div>

      <button className="btn" style={{
        background: theme.btnBg, border: "1px solid " + theme.btnBorder, color: theme.btnText,
        height: mobile ? 40 : "var(--control-h)", width: "100%",
      }}>+ Add account</button>
    </div>
  );
}

Object.assign(window, { Sidebar, sidebarTheme, shellAccounts });
