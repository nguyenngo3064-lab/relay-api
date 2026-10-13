// src/dashboard/html.js
// Dashboard shell (single-page). Served by the server for non-API GET routes.
// Self-contained, no third-party scripts/fonts, system fonts only, to satisfy
// the restrictive CSP. Design follows the installed taste skills: clean
// editorial-minimalist aesthetic, strong typographic hierarchy, restrained
// monochrome palette with muted semantic accents, no emojis, real loading/
// empty/error states, and responsive collapse.

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
<style>
  :root {
    --bg: #f7f6f3; --surface: #ffffff; --surface-2: #fbfbfa;
    --ink: #16171a; --ink-2: #4b4d52; --muted: #787774;
    --line: #eaeaea; --line-2: rgba(0,0,0,0.06);
    --accent: #1f1f22; --focus: #1f6c9f;
    --ok-bg:#edf3ec; --ok-ink:#346538;
    --warn-bg:#fbf3db; --warn-ink:#956400;
    --err-bg:#fdebec; --err-ink:#9f2f2d;
    --info-bg:#e1f3fe; --info-ink:#1f6c9f;
    --radius: 14px; --radius-lg: 22px;
    --font: 'SF Pro Display','Geist Sans','Helvetica Neue',system-ui,sans-serif;
    --mono: 'Geist Mono','SF Mono','JetBrains Mono',ui-monospace,monospace;
  }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  body { background: var(--bg); color: var(--ink); font-family: var(--font);
    line-height:1.6; -webkit-font-smoothing:antialiased; }
  a { color: var(--focus); }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 40px 24px 96px; }
  header.top { display:flex; align-items:baseline; justify-content:space-between;
    gap:16px; padding-bottom: 28px; border-bottom:1px solid var(--line); margin-bottom:36px; }
  .brand { font-size: 22px; font-weight:600; letter-spacing:-0.02em; }
  .brand small { color: var(--muted); font-weight:400; font-size:13px; margin-left:10px; }
  nav.tabs { display:flex; flex-wrap:wrap; gap:4px; }
  nav.tabs button { font-family:var(--font); font-size:14px; color:var(--ink-2);
    background:transparent; border:1px solid transparent; border-radius:10px;
    padding:8px 14px; cursor:pointer; transition: all .2s cubic-bezier(.16,1,.3,1); }
  nav.tabs button:hover { background: var(--surface-2); }
  nav.tabs button.active { background: var(--surface); border-color: var(--line); color: var(--ink); }
  h1 { font-size: clamp(1.8rem, 3vw, 2.6rem); letter-spacing:-0.03em; line-height:1.1;
    font-weight:600; margin: 0 0 8px; }
  h2 { font-size: 1.05rem; letter-spacing:-0.01em; font-weight:600; margin:0 0 4px; }
  p.lede { color: var(--ink-2); max-width: 60ch; margin: 0 0 28px; }
  .grid { display:grid; gap:16px; }
  .cards { grid-template-columns: repeat(4, 1fr); }
  .cards-2 { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 820px){ .cards, .cards-2 { grid-template-columns: repeat(2,1fr);} }
  @media (max-width: 540px){ .cards, .cards-2 { grid-template-columns: 1fr;} }
  .card { background: var(--surface); border:1px solid var(--line); border-radius: var(--radius);
    padding:18px 18px 16px; }
  .card .k { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  .card .v { font-size: 1.7rem; font-weight:600; letter-spacing:-0.02em; margin-top:6px; font-family:var(--mono); }
  .card .sub { font-size:12px; color:var(--muted); margin-top:2px; }
  .panel { background: var(--surface); border:1px solid var(--line); border-radius: var(--radius-lg);
    padding:24px; margin-top:20px; }
  label.field { display:block; margin: 0 0 14px; }
  label.field span { display:block; font-size:13px; color:var(--ink-2); margin-bottom:6px; }
  input, select, textarea { font-family:var(--font); font-size:14px; color:var(--ink);
    width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--surface-2);
    transition: border-color .2s, box-shadow .2s; }
  input:focus, select:focus, textarea:focus { outline:none; border-color: var(--focus);
    box-shadow: 0 0 0 3px rgba(31,108,159,.15); }
  textarea { font-family: var(--mono); min-height: 84px; resize: vertical; }
  button.btn { font-family:var(--font); font-size:14px; font-weight:500; cursor:pointer;
    background: var(--accent); color:#fff; border:1px solid var(--accent); border-radius:10px; padding:10px 16px;
    transition: transform .15s, opacity .15s; }
  button.btn:hover { opacity:.92; }
  button.btn:active { transform: scale(.98); }
  button.btn.ghost { background:transparent; color:var(--ink); border-color:var(--line); }
  button.btn.danger { background: var(--err-ink); border-color: var(--err-ink); }
  button.btn[disabled] { opacity:.5; cursor:not-allowed; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  td.mono, .mono { font-family: var(--mono); }
  .pill { display:inline-block; font-size:12px; padding:2px 10px; border-radius:999px; }
  .pill.ok { background:var(--ok-bg); color:var(--ok-ink); }
  .pill.warn { background:var(--warn-bg); color:var(--warn-ink); }
  .pill.err { background:var(--err-bg); color:var(--err-ink); }
  .pill.info { background:var(--info-bg); color:var(--info-ink); }
  .pill.mute { background:var(--surface-2); color:var(--muted); }
  .msg { border-radius:10px; padding:12px 14px; font-size:13px; margin: 0 0 16px; border:1px solid; }
  .msg.err { background:var(--err-bg); color:var(--err-ink); border-color:rgba(159,47,45,.2); }
  .msg.ok { background:var(--ok-bg); color:var(--ok-ink); border-color:rgba(52,101,56,.2); }
  .msg.warn { background:var(--warn-bg); color:var(--warn-ink); border-color:rgba(149,100,0,.2); }
  .hidden { display:none !important; }
  .empty { color:var(--muted); font-size:14px; padding:24px; text-align:center;
    border:1px dashed var(--line); border-radius: var(--radius); }
  .muted { color: var(--muted); }
  .spinner { width:16px; height:16px; border:2px solid var(--line); border-top-color: var(--ink);
    border-radius:50%; display:inline-block; animation: spin .7s linear infinite; vertical-align:-3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  code { font-family:var(--mono); font-size:12.5px; background:var(--surface-2);
    padding:1px 6px; border-radius:6px; border:1px solid var(--line); }
  pre { font-family:var(--mono); font-size:12.5px; background:var(--surface-2); border:1px solid var(--line);
    border-radius:10px; padding:14px; overflow:auto; max-height:320px; }
  .kv { display:grid; grid-template-columns: 160px 1fr; gap:6px 16px; font-size:13px; }
  .kv dt { color:var(--muted); }
  .kv dd { margin:0; font-family:var(--mono); }
  @media (prefers-reduced-motion: reduce){ * { animation:none !important; transition:none !important; } }
  .login-shell { max-width: 420px; margin: 12vh auto; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/app.js" defer></script>
</body>
</html>`;

