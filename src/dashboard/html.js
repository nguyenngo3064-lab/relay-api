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
<meta name="description" content="HUAN RELAY control panel — self-hosted OpenAI-compatible AI API gateway." />
<meta name="color-scheme" content="dark" />
<style>
  :root {
    --bg: #08090d;
    --surface: rgba(255,255,255,0.028);
    --surface-2: rgba(255,255,255,0.05);
    --surface-solid: #12141a;
    --ink: #eef1f6; --ink-2: #aab2c0; --muted: #6c7482;
    --line: rgba(255,255,255,0.08); --line-2: rgba(255,255,255,0.05);
    --accent: #2dd4bf; --accent-ink: #04211d;
    --focus: #2dd4bf;
    --ok-bg: rgba(52,211,153,0.12); --ok-ink:#5ee9b5;
    --warn-bg: rgba(251,191,36,0.13); --warn-ink:#fcd34d;
    --err-bg: rgba(248,113,113,0.13); --err-ink:#fca5a5;
    --info-bg: rgba(45,212,191,0.13); --info-ink:#5eead4;
    --radius: 16px; --radius-lg: 24px;
    --font: 'Geist Sans','SF Pro Display','Helvetica Neue',system-ui,-apple-system,sans-serif;
    --mono: 'Geist Mono','SF Mono','JetBrains Mono',ui-monospace,monospace;
    --ease: cubic-bezier(.16,1,.3,1);
    --shadow: 0 24px 60px -24px rgba(0,0,0,0.7);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  html,body { margin:0; padding:0; }
  body {
    background: var(--bg); color: var(--ink); font-family: var(--font);
    line-height:1.6; -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
    min-height:100vh; position:relative; overflow-x:hidden;
  }
  /* Ambient animated gradient field behind everything. */
  body::before {
    content:""; position:fixed; inset:-20vh -20vw; z-index:-2; pointer-events:none;
    background:
      radial-gradient(42vw 42vw at 12% 8%, rgba(45,212,191,0.16), transparent 60%),
      radial-gradient(38vw 38vw at 88% 18%, rgba(56,130,246,0.12), transparent 62%),
      radial-gradient(46vw 46vw at 70% 96%, rgba(168,85,247,0.10), transparent 60%);
    filter: blur(6px); animation: drift 26s var(--ease) infinite alternate;
  }
  /* Fine grain overlay to break digital flatness. */
  body::after {
    content:""; position:fixed; inset:0; z-index:-1; pointer-events:none; opacity:.5;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
  }
  @keyframes drift {
    0%   { transform: translate3d(0,0,0) scale(1); }
    50%  { transform: translate3d(2vw,-2vh,0) scale(1.06); }
    100% { transform: translate3d(-2vh,2vw,0) scale(1.02); }
  }
  @keyframes rise { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform:none; } }
  @keyframes fadein { from { opacity:0; } to { opacity:1; } }
  a { color: var(--focus); text-decoration:none; }
  a:hover { text-decoration:underline; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 48px 24px 120px; }
  header.top {
    display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;
    gap:16px; padding-bottom: 26px; border-bottom:1px solid var(--line); margin-bottom:38px;
    animation: rise .6s var(--ease) both;
  }
  .brand { font-size: 22px; font-weight:600; letter-spacing:-0.02em; display:flex; align-items:baseline; gap:10px; }
  .brand .dot { width:9px; height:9px; border-radius:50%; background:var(--accent);
    box-shadow:0 0 0 4px rgba(45,212,191,0.16); animation: pulse 2.6s var(--ease) infinite; }
  @keyframes pulse { 0%,100%{ box-shadow:0 0 0 4px rgba(45,212,191,0.16);} 50%{ box-shadow:0 0 0 9px rgba(45,212,191,0.04);} }
  .brand small { color: var(--muted); font-weight:400; font-size:13px; }
  nav.tabs { display:flex; flex-wrap:wrap; gap:4px; }
  nav.tabs button { font-family:var(--font); font-size:14px; font-weight:500; color:var(--ink-2);
    background:transparent; border:1px solid transparent; border-radius:11px;
    padding:8px 14px; cursor:pointer; transition: color .2s var(--ease), background .2s var(--ease), border-color .2s var(--ease), transform .2s var(--ease); }
  nav.tabs button:hover { background: var(--surface-2); color:var(--ink); transform: translateY(-1px); }
  nav.tabs button.active { background: var(--surface-2); border-color: var(--line); color: var(--ink); }
  h1 { font-size: clamp(1.9rem, 3.4vw, 2.8rem); letter-spacing:-0.035em; line-height:1.05;
    font-weight:600; margin: 0 0 10px; text-wrap:balance; }
  h2 { font-size: 1.05rem; letter-spacing:-0.01em; font-weight:600; margin:0 0 4px; }
  p.lede { color: var(--ink-2); max-width: 62ch; margin: 0 0 30px; font-size:15px; }
  .grid { display:grid; gap:16px; }
  .cards { grid-template-columns: repeat(4, 1fr); }
  .cards-2 { grid-template-columns: repeat(2, 1fr); }
  @media (max-width: 820px){ .cards, .cards-2 { grid-template-columns: repeat(2,1fr);} }
  @media (max-width: 540px){ .cards, .cards-2 { grid-template-columns: 1fr;} }
  .card {
    background: var(--surface); border:1px solid var(--line); border-radius: var(--radius);
    padding:18px 18px 16px; position:relative; overflow:hidden;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), var(--shadow);
    animation: rise .55s var(--ease) both;
    transition: transform .3s var(--ease), border-color .3s var(--ease);
  }
  .card:nth-child(2){ animation-delay:.05s } .card:nth-child(3){ animation-delay:.1s } .card:nth-child(4){ animation-delay:.15s }
  .card:hover { transform: translateY(-3px); border-color: rgba(45,212,191,0.28); }
  .card::after {
    content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none; opacity:0;
    background: radial-gradient(180px 120px at 80% 0%, rgba(45,212,191,0.12), transparent 70%);
    transition: opacity .3s var(--ease);
  }
  .card:hover::after { opacity:1; }
  .card .k { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .card .v { font-size: 1.8rem; font-weight:600; letter-spacing:-0.02em; margin-top:6px;
    font-family:var(--mono); font-variant-numeric: tabular-nums; }
  .card .sub { font-size:12px; color:var(--muted); margin-top:3px; }
  .panel {
    background: var(--surface); border:1px solid var(--line); border-radius: var(--radius-lg);
    padding:26px; margin-top:20px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), var(--shadow);
    animation: rise .55s var(--ease) both; animation-delay:.08s;
  }
  label.field { display:block; margin: 0 0 14px; }
  label.field span { display:block; font-size:13px; color:var(--ink-2); margin-bottom:6px; }
  input, select, textarea { font-family:var(--font); font-size:14px; color:var(--ink);
    width:100%; padding:11px 13px; border:1px solid var(--line); border-radius:12px;
    background: var(--surface-2); transition: border-color .2s var(--ease), box-shadow .2s var(--ease), background .2s var(--ease); }
  input::placeholder, textarea::placeholder { color: var(--muted); }
  input:focus, select:focus, textarea:focus { outline:none; border-color: var(--focus);
    box-shadow: 0 0 0 3px rgba(45,212,191,0.18); background: rgba(255,255,255,0.06); }
  textarea { font-family: var(--mono); min-height: 84px; resize: vertical; }
  button.btn { font-family:var(--font); font-size:14px; font-weight:600; cursor:pointer;
    background: var(--accent); color:var(--accent-ink); border:1px solid var(--accent); border-radius:12px;
    padding:11px 18px; transition: transform .18s var(--ease), box-shadow .2s var(--ease), opacity .15s;
    box-shadow: 0 8px 24px -10px rgba(45,212,191,0.6); }
  button.btn:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -12px rgba(45,212,191,0.7); }
  button.btn:active { transform: translateY(0) scale(.98); }
  button.btn.ghost { background:transparent; color:var(--ink); border-color:var(--line); box-shadow:none; }
  button.btn.ghost:hover { background: var(--surface-2); border-color: rgba(255,255,255,0.16); }
  button.btn.danger { background: var(--err-ink); border-color: var(--err-ink); color:#2a0b0b;
    box-shadow: 0 8px 24px -10px rgba(248,113,113,0.5); }
  button.btn[disabled] { opacity:.5; cursor:not-allowed; transform:none; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:11px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  tbody tr { transition: background .2s var(--ease); }
  tbody tr:hover { background: var(--surface-2); }
  th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  td.mono, .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .pill { display:inline-block; font-size:12px; font-weight:500; padding:3px 11px; border-radius:999px; border:1px solid transparent; }
  .pill.ok { background:var(--ok-bg); color:var(--ok-ink); border-color:rgba(52,211,153,0.25); }
  .pill.warn { background:var(--warn-bg); color:var(--warn-ink); border-color:rgba(251,191,36,0.25); }
  .pill.err { background:var(--err-bg); color:var(--err-ink); border-color:rgba(248,113,113,0.25); }
  .pill.info { background:var(--info-bg); color:var(--info-ink); border-color:rgba(45,212,191,0.25); }
  .pill.mute { background:var(--surface-2); color:var(--muted); border-color:var(--line); }
  .msg { border-radius:12px; padding:13px 15px; font-size:13px; margin: 0 0 16px; border:1px solid;
    animation: fadein .4s var(--ease) both; }
  .msg.err { background:var(--err-bg); color:var(--err-ink); border-color:rgba(248,113,113,0.25); }
  .msg.ok { background:var(--ok-bg); color:var(--ok-ink); border-color:rgba(52,211,153,0.25); }
  .msg.warn { background:var(--warn-bg); color:var(--warn-ink); border-color:rgba(251,191,36,0.25); }
  .hidden { display:none !important; }
  .empty { color:var(--muted); font-size:14px; padding:28px; text-align:center;
    border:1px dashed var(--line); border-radius: var(--radius); animation: fadein .4s var(--ease) both; }
  .muted { color: var(--muted); }
  .spinner { width:16px; height:16px; border:2px solid var(--line); border-top-color: var(--accent);
    border-radius:50%; display:inline-block; animation: spin .7s linear infinite; vertical-align:-3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  code { font-family:var(--mono); font-size:12.5px; background:var(--surface-2);
    padding:2px 7px; border-radius:7px; border:1px solid var(--line); }
  pre { font-family:var(--mono); font-size:12.5px; background:var(--surface-2); border:1px solid var(--line);
    border-radius:12px; padding:14px; overflow:auto; max-height:320px; color:var(--ok-ink); }
  .kv { display:grid; grid-template-columns: 170px 1fr; gap:7px 16px; font-size:13px; }
  .kv dt { color:var(--muted); }
  .kv dd { margin:0; font-family:var(--mono); font-variant-numeric: tabular-nums; }
  main { animation: fadein .4s var(--ease) both; }
  @media (prefers-reduced-motion: reduce){ * { animation:none !important; transition:none !important; } }
  .login-shell { max-width: 440px; margin: 12vh auto; }
  .login-shell .panel { animation: rise .6s var(--ease) both; }
</style>
</head>
<body>
<div id="root"></div>
<script src="/app.js" defer></script>
</body>
</html>`;

