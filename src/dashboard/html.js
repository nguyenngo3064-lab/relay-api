// src/dashboard/html.js
// Dashboard shell (single-page). Served by the server for non-API GET routes.
// Self-contained: system fonts, inline SVG only, no third-party assets, so it
// satisfies the restrictive CSP.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Dashboard client script, served from /app.js. */
export const DASHBOARD_JS = readFileSync(join(__dirname, 'static', 'app.js'), 'utf8');

export const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HUAN RELAY</title>
<meta name="description" content="HUAN RELAY control panel - self-hosted OpenAI-compatible AI API gateway." />
<meta name="color-scheme" content="light" />
<style>
  :root {
    --bg: #f2f5f9;
    --surface: #ffffff;
    --surface-2: #eef2f7;
    --surface-3: #e3e9f1;
    --ink: #1c2733; --ink-2: #465363; --ink-3: #5a6b7f;
    --muted: #71809a;
    --line: #dde5ee; --line-2: #cfd9e5;
    --accent: #0d9488; --accent-2: #0f766e; --accent-ink: #ffffff;
    --accent-soft: rgba(13,148,136,0.10);
    --focus: #14b8a6;
    --ok-bg: #e3f7ee; --ok-ink: #0f7a52; --ok-line: #a7dcc3;
    --warn-bg: #fdf3d8; --warn-ink: #92600a; --warn-line: #ecd493;
    --err-bg: #fdeaea; --err-ink: #a33232; --err-line: #eeb4b4;
    --info-bg: #e5f1fd; --info-ink: #1f5fa8; --info-line: #b4d2ee;
    --radius: 12px; --radius-lg: 16px;
    --font: 'SF Pro Display','Segoe UI',system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif;
    --mono: 'SF Mono','JetBrains Mono',ui-monospace,'Cascadia Mono',Menlo,Consolas,monospace;
    --ease: cubic-bezier(.16,1,.3,1);
    --shadow: 0 1px 2px rgba(28,39,51,0.05), 0 10px 28px -18px rgba(28,39,51,0.25);
    --shadow-lg: 0 2px 6px rgba(28,39,51,0.06), 0 22px 48px -26px rgba(28,39,51,0.30);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  html,body { margin:0; padding:0; }
  body {
    background: var(--bg); color: var(--ink); font-family: var(--font);
    line-height:1.55; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
    min-height:100vh;
  }
  @keyframes fadein { from { opacity:0; } to { opacity:1; } }
  @keyframes rise { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform:none; } }
  a { color: var(--accent-2); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 20px 96px; }
  header.top {
    display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;
    gap:14px; padding-bottom: 18px; border-bottom:1px solid var(--line); margin-bottom:26px;
  }
  .brand { display:flex; align-items:center; gap:12px; min-width:0; }
  .brand svg { width:38px; height:38px; flex:none; }
  .brand .bt { display:flex; flex-direction:column; line-height:1.2; min-width:0; }
  .brand .bt b { font-size:17px; font-weight:700; letter-spacing:-0.01em; }
  .brand .bt span { font-size:12px; color:var(--muted); }
  nav.tabs { display:flex; flex-wrap:wrap; gap:6px; }
  nav.tabs button {
    font-family:var(--font); font-size:13px; font-weight:600; color:var(--ink-3);
    background:var(--surface); border:1px solid var(--line); border-radius:10px;
    padding:8px 12px; cursor:pointer; display:inline-flex; align-items:center; gap:7px;
    transition: color .18s var(--ease), background .18s var(--ease), border-color .18s var(--ease);
  }
  nav.tabs button svg { width:15px; height:15px; flex:none; }
  nav.tabs button:hover { background: var(--surface-2); color:var(--ink); border-color: var(--line-2); }
  nav.tabs button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .topbar-extra { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .langswitch { display:inline-flex; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--surface); }
  .langswitch button {
    font-family:var(--font); font-size:12px; font-weight:700; color:var(--ink-3);
    background:transparent; border:none; padding:7px 11px; cursor:pointer; letter-spacing:.03em;
  }
  .langswitch button.active { background: var(--accent); color: var(--accent-ink); }
  h1 { font-size: clamp(1.5rem, 3vw, 2rem); letter-spacing:-0.02em; line-height:1.15;
    font-weight:700; margin: 0 0 8px; }
  h2 { font-size: 1rem; letter-spacing:-0.01em; font-weight:700; margin:0 0 4px; }
  p.lede { color: var(--ink-3); max-width: 68ch; margin: 0 0 22px; font-size:14px; }
  .grid { display:grid; gap:14px; }
  .cards { grid-template-columns: repeat(4, minmax(0,1fr)); }
  .cards-2 { grid-template-columns: repeat(2, minmax(0,1fr)); }
  @media (max-width: 900px){ .cards { grid-template-columns: repeat(2,minmax(0,1fr)); } }
  @media (max-width: 540px){ .cards, .cards-2 { grid-template-columns: 1fr;} }
  .card {
    background: var(--surface); border:1px solid var(--line); border-radius: var(--radius);
    padding:16px; box-shadow: var(--shadow);
  }
  .card .k { font-size:11px; text-transform:uppercase; letter-spacing:.07em; color:var(--muted); font-weight:600; }
  .card .v { font-size: 1.55rem; font-weight:700; letter-spacing:-0.02em; margin-top:5px;
    font-family:var(--mono); font-variant-numeric: tabular-nums; }
  .card .sub { font-size:12px; color:var(--muted); margin-top:3px; }
  .panel {
    background: var(--surface); border:1px solid var(--line); border-radius: var(--radius-lg);
    padding:22px; margin-top:16px; box-shadow: var(--shadow);
  }
  .panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
  label.field { display:block; margin: 0 0 14px; }
  label.field > span { display:block; font-size:13px; color:var(--ink-3); margin-bottom:5px; font-weight:600; }
  label.field .hint { font-weight:400; color:var(--muted); font-size:12px; margin-top:4px; }
  input, select, textarea { font-family:var(--font); font-size:14px; color:var(--ink);
    width:100%; padding:10px 12px; border:1px solid var(--line-2); border-radius:10px;
    background: var(--surface); transition: border-color .18s var(--ease), box-shadow .18s var(--ease); }
  input::placeholder, textarea::placeholder { color: var(--muted); }
  input:focus, select:focus, textarea:focus { outline:none; border-color: var(--focus);
    box-shadow: 0 0 0 3px rgba(20,184,166,0.16); }
  textarea { font-family: var(--mono); min-height: 84px; resize: vertical; font-size:13px; }
  button.btn { font-family:var(--font); font-size:13.5px; font-weight:700; cursor:pointer;
    background: var(--accent); color:var(--accent-ink); border:1px solid var(--accent); border-radius:10px;
    padding:10px 16px; transition: background .18s var(--ease), transform .15s var(--ease), opacity .15s; }
  button.btn:hover { background: var(--accent-2); border-color: var(--accent-2); }
  button.btn:active { transform: scale(.98); }
  button.btn.ghost { background:var(--surface); color:var(--ink); border-color:var(--line-2); }
  button.btn.ghost:hover { background: var(--surface-2); }
  button.btn.danger { background: var(--surface); border-color: var(--err-line); color: var(--err-ink); }
  button.btn.danger:hover { background: var(--err-bg); }
  button.btn.sm { padding:6px 10px; font-size:12px; border-radius:8px; }
  button.btn[disabled] { opacity:.5; cursor:not-allowed; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .tablewrap { overflow-x:auto; border:1px solid var(--line); border-radius: var(--radius); }
  table { width:100%; border-collapse:collapse; font-size:13px; min-width:520px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr { transition: background .15s var(--ease); }
  tbody tr:hover { background: var(--surface-2); }
  th { color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.06em;
    background:var(--surface-2); white-space:nowrap; }
  td.mono, .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .pill { display:inline-block; font-size:11.5px; font-weight:600; padding:2px 10px; border-radius:999px; border:1px solid transparent; }
  .pill.ok { background:var(--ok-bg); color:var(--ok-ink); border-color:var(--ok-line); }
  .pill.warn { background:var(--warn-bg); color:var(--warn-ink); border-color:var(--warn-line); }
  .pill.err { background:var(--err-bg); color:var(--err-ink); border-color:var(--err-line); }
  .pill.info { background:var(--info-bg); color:var(--info-ink); border-color:var(--info-line); }
  .pill.mute { background:var(--surface-2); color:var(--muted); border-color:var(--line); }
  .msg { border-radius:10px; padding:11px 14px; font-size:13px; margin: 0 0 14px; border:1px solid; }
  .msg.err { background:var(--err-bg); color:var(--err-ink); border-color:var(--err-line); }
  .msg.ok { background:var(--ok-bg); color:var(--ok-ink); border-color:var(--ok-line); }
  .msg.warn { background:var(--warn-bg); color:var(--warn-ink); border-color:var(--warn-line); }
  .hidden { display:none !important; }
  .empty { color:var(--muted); font-size:13.5px; padding:26px; text-align:center;
    border:1px dashed var(--line-2); border-radius: var(--radius); }
  .muted { color: var(--muted); }
  .spinner { width:15px; height:15px; border:2px solid var(--line-2); border-top-color: var(--accent);
    border-radius:50%; display:inline-block; animation: spin .7s linear infinite; vertical-align:-3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  code { font-family:var(--mono); font-size:12px; background:var(--surface-2);
    padding:2px 6px; border-radius:6px; border:1px solid var(--line); }
  pre { font-family:var(--mono); font-size:12px; background:var(--surface-2); border:1px solid var(--line);
    border-radius:10px; padding:12px; overflow:auto; max-height:300px; color:var(--ink); word-break:break-all; white-space:pre-wrap; }
  .kv { display:grid; grid-template-columns: 160px 1fr; gap:6px 14px; font-size:13px; }
  @media (max-width: 540px){ .kv { grid-template-columns: 1fr; gap:2px 0; } .kv dd { margin-bottom:8px; } }
  .kv dt { color:var(--muted); }
  .kv dd { margin:0; font-family:var(--mono); font-variant-numeric: tabular-nums; word-break:break-all; }
  main { animation: fadein .3s var(--ease) both; }
  .stack { display:flex; flex-direction:column; gap:14px; }
  .prov { border:1px solid var(--line); border-radius: var(--radius); padding:16px; background:var(--surface); }
  .prov + .prov { margin-top:12px; }
  .prov-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .prov-title { display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0; }
  .prov-title b { font-size:15px; }
  .prov-meta { font-size:12px; color:var(--muted); margin-top:3px; word-break:break-all; }
  .chart-frame { border:1px solid var(--line); border-radius: var(--radius); padding:14px 14px 8px; background:var(--surface); }
  @media (prefers-reduced-motion: reduce){ * { animation:none !important; transition:none !important; } }
  .login-shell { max-width: 420px; margin: 10vh auto; }
  .login-shell .brand { justify-content:center; margin-bottom:18px; }
  .login-shell .panel { box-shadow: var(--shadow-lg); }
  .form-grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:0 14px; }
  @media (max-width: 640px){ .form-grid { grid-template-columns: 1fr; } }
  .form-grid .full { grid-column: 1 / -1; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/app.js" defer></script>
</body>
</html>`;
