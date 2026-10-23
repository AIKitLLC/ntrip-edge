/**
 * Stylesheet of the NTRIP Edge Playground & Docs.
 * System fonts only (no external requests), light and dark from prefers-color-scheme,
 * matching AI Kit LLC edge service design language.
 */

export const LANDING_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f8fb;
  --surface: #ffffff;
  --surface-2: #eef2f7;
  --border: #d8e0ea;
  --text: #0f172a;
  --muted: #526075;
  --accent: #0369a1;
  --accent-ink: #ffffff;
  --ok: #15803d;
  --warn: #b45309;
  --bad: #b91c1c;
  --code-bg: #0f172a;
  --code-text: #e2e8f0;
  --shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 12px 32px rgba(15, 23, 42, 0.07);
  --glow: rgba(3, 105, 161, 0.1);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a0f1a;
    --surface: #111a2b;
    --surface-2: #172238;
    --border: #25324a;
    --text: #e8eef7;
    --muted: #93a3bb;
    --accent: #38bdf8;
    --accent-ink: #04121f;
    --ok: #4ade80;
    --warn: #fbbf24;
    --bad: #f87171;
    --code-bg: #070b14;
    --code-text: #dbe5f3;
    --shadow: none;
    --glow: rgba(56, 189, 248, 0.12);
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  background-image: radial-gradient(60rem 26rem at 50% -8rem, var(--glow), transparent 70%);
  background-repeat: no-repeat;
  color: var(--text);
  font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 20px; }
.skip { position: absolute; left: 12px; top: -48px; background: var(--accent); color: var(--accent-ink); padding: 8px 14px; border-radius: 8px; z-index: 10; }
.skip:focus { top: 12px; text-decoration: none; }

/* header */
.top { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; padding: 18px 0; flex-wrap: wrap; border-bottom: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -0.01em; color: var(--text); }
.brand:hover { text-decoration: none; }
.brand svg { color: var(--accent); }
.nav { display: flex; align-items: center; gap: 8px 20px; flex-wrap: wrap; }
.nav a.link { color: var(--muted); font-size: 0.94rem; font-weight: 500; }
.nav a.link:hover { color: var(--text); text-decoration: none; }
.pill { display: inline-flex; align-items: center; gap: 7px; font-size: 0.78rem; font-weight: 650; padding: 4px 11px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface); }
.pill i { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.gh { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface); color: var(--text) !important; font-size: 0.9rem; font-weight: 600; }
.gh:hover { border-color: var(--accent); text-decoration: none !important; }

/* hero */
.hero { padding: 34px 0 16px; }
.eyebrow { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
h1 { font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1.08; letter-spacing: -0.03em; margin: 0.3em 0 0.35em; font-weight: 800; }
.lead { max-width: 70ch; color: var(--muted); font-size: 1.06rem; margin: 0 0 22px; }
.lead code { color: var(--text); font-size: 0.92em; background: var(--surface-2); padding: 2px 6px; border-radius: 6px; }

/* panels & cards */
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 20px; box-shadow: var(--shadow); margin-bottom: 22px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.panel-title { font-size: 1.15rem; font-weight: 750; margin: 0; letter-spacing: -0.01em; }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
.input, .select {
  height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); font: 600 0.95rem ui-monospace, SFMono-Regular, Menlo, monospace;
}
.input:focus, .select:focus, .ta:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
.ta {
  width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border);
  background: var(--bg); color: var(--text); font: 0.86rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical;
}
.btn {
  height: 44px; padding: 0 20px; border-radius: 10px; border: 0; background: var(--accent); color: var(--accent-ink);
  font: 700 0.94rem system-ui, sans-serif; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;
}
.btn:hover { filter: brightness(1.08); }
.btn:disabled { opacity: 0.6; cursor: progress; }
.btn.ghost { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn.ghost:hover { border-color: var(--accent); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; align-items: center; }
.chips span { color: var(--muted); font-size: 0.84rem; font-weight: 600; }
.chip {
  border: 1px solid var(--border); background: var(--surface-2); color: var(--text); border-radius: 999px;
  padding: 5px 13px; font-size: 0.84rem; font-weight: 650; cursor: pointer;
}
.chip:hover, .chip.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, var(--surface)); }

/* badges & facts */
.badges { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.badge { font-size: 0.78rem; font-weight: 700; padding: 3px 11px; border-radius: 999px; border: 1px solid; }
.badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); background: color-mix(in srgb, var(--ok) 10%, transparent); }
.badge.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: color-mix(in srgb, var(--warn) 10%, transparent); }
.badge.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); background: color-mix(in srgb, var(--bad) 10%, transparent); }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(195px, 1fr)); gap: 10px; margin: 14px 0; }
.fact { background: var(--surface-2); border-radius: 12px; padding: 10px 14px; min-width: 0; }
.fact dt { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
.fact dd { margin: 3px 0 0; font-weight: 650; font-size: 0.94rem; overflow-wrap: break-word; }

/* tables & skybars */
.scroll { max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: 12px; margin-top: 10px; }
.attrs { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
.attrs th { position: sticky; top: 0; padding: 8px 12px; text-align: left; font-size: 0.74rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); background: var(--surface); border-bottom: 1px solid var(--border); }
.attrs td { padding: 7px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.attrs tr:last-child td { border-bottom: 0; }
.cnr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px; margin-top: 10px; }
.cnr-cell { background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 6px; text-align: center; font-size: 0.75rem; }
.cnr-bar { height: 6px; border-radius: 4px; background: var(--border); overflow: hidden; margin: 4px 0; }
.cnr-fill { height: 100%; background: var(--ok); }

/* code & endpoints */
.code { position: relative; background: var(--code-bg); color: var(--code-text); border-radius: 12px; padding: 12px 16px; overflow: auto; font-size: 0.84rem; line-height: 1.55; margin: 8px 0 0; }
.code code { white-space: pre; }
section.block { padding: 32px 0 0; }
h2 { font-size: clamp(1.35rem, 3vw, 1.8rem); letter-spacing: -0.02em; margin: 0 0 8px; }
.sec-lead { color: var(--muted); margin: 0 0 18px; max-width: 68ch; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px; }
.card h3 { margin: 0 0 6px; font-size: 1.02rem; }
.card p { margin: 0; color: var(--muted); font-size: 0.92rem; }
.ep { list-style: none; margin: 0 0 20px; padding: 0; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); overflow: hidden; }
.ep li { display: grid; grid-template-columns: 64px minmax(0, 1.3fr) minmax(0, 1fr); gap: 4px 14px; padding: 11px 16px; border-bottom: 1px solid var(--border); align-items: baseline; }
.ep li:last-child { border-bottom: 0; }
.verb { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.05em; color: var(--accent); }
.ep code { font-size: 0.86rem; overflow-wrap: anywhere; }
.ep span.d { color: var(--muted); font-size: 0.9rem; }
footer.foot { margin-top: 48px; padding: 24px 0 38px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.85rem; }
footer.foot p { margin: 0 0 6px; }
@media (max-width: 720px) {
  .wrap { padding: 0 14px; }
  .ep li { grid-template-columns: 1fr; }
}
`;
