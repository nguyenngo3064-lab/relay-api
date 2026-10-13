// HUAN RELAY dashboard client. Talks only to the real backend API.
// No third-party libraries. Respects the CSP (no inline handlers).
(function () {
  'use strict';
  var state = { authed: false, tab: 'overview', csrf: '', data: {} };
  var root = document.getElementById('root');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) { if (n == null) return '\u2014'; if (n >= 1e9) return (n/1e9).toFixed(1)+'B'; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'k'; return String(n); }
  function fmtUptime(ms) { var s = Math.floor(ms/1000); var h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60; return h+'h '+m+'m '+sec+'s'; }
  function fmtBytes(b){ if(b==null) return '\u2014'; var u=['B','KB','MB','GB'], i=0; while(b>=1024&&i<u.length-1){b/=1024;i++;} return b.toFixed(1)+' '+u[i]; }

  async function api(path, opts) {
    opts = opts || {};
    var headers = { 'content-type': 'application/json' };
    if (state.csrf && opts.method && opts.method !== 'GET') headers['x-csrf-token'] = state.csrf;
    var res = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      credentials: 'same-origin',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    var text = await res.text();
    var json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = { raw: text }; }
    if (!res.ok) { var msg = (json && json.error && json.error.message) || ('HTTP ' + res.status); throw new Error(msg); }
    return json;
  }

  function msg(kind, text) { return '<div class="msg ' + kind + '">' + esc(text) + '</div>'; }
  function pill(status) {
    var map = { success:'ok', fallback:'info', error:'err', rate_limited:'warn' };
    var cls = map[status] || 'mute';
    return '<span class="pill ' + cls + '">' + esc(status) + '</span>';
  }

  /* ------------------------------- Views ------------------------------- */
  function renderLogin(setupRequired, banner) {
    root.innerHTML =
      '<div class="login-shell panel">' +
      '<h1>' + (setupRequired ? 'Create administrator' : 'Sign in') + '</h1>' +
      '<p class="lede">HUAN RELAY control panel. ' + (setupRequired ? 'Set a strong administrator password (min 12 characters) to begin.' : 'Enter your administrator password.') + '</p>' +
      (banner || '') +
      '<form id="authform">' +
      '<label class="field"><span>Password</span><input type="password" id="pw" autocomplete="current-password" required /></label>' +
      '<div class="row"><button class="btn" type="submit">' + (setupRequired ? 'Create account' : 'Sign in') + '</button></div>' +
      '</form></div>';
    document.getElementById('authform').addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = document.getElementById('pw').value;
      var btn = e.target.querySelector('button');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        var r = await api(setupRequired ? '/api/auth/setup' : '/api/auth/login', { method:'POST', body:{ password: pw } });
        state.csrf = r.csrfToken; state.authed = true;
        boot();
      } catch (err) {
        renderLogin(setupRequired, msg('err', err.message));
      }
    });
  }

  function shell(inner) {
    var tabs = ['overview','providers','keys','usage','context','settings'];
    var labels = { overview:'Overview', providers:'Providers', keys:'Client keys', usage:'Usage', context:'Context engine', settings:'Security' };
    var nav = tabs.map(function(t){ return '<button data-tab="'+t+'" class="'+(state.tab===t?'active':'')+'">'+labels[t]+'</button>'; }).join('');
    return '<div class="wrap">' +
      '<header class="top"><div class="brand">HUAN RELAY <small>self-hosted AI gateway</small></div>' +
      '<nav class="tabs">'+nav+'</nav>' +
      '<button class="btn ghost" id="logout">Sign out</button></header>' +
      '<main>'+inner+'</main></div>';
  }

  function bindShell() {
    var btns = root.querySelectorAll('nav.tabs button');
    btns.forEach(function(b){ b.addEventListener('click', function(){ state.tab = b.getAttribute('data-tab'); route(); }); });
    var lo = document.getElementById('logout');
    if (lo) lo.addEventListener('click', async function(){ try { await api('/api/auth/logout', { method:'POST' }); } catch(e){} state.authed=false; state.csrf=''; boot(); });
  }

  function viewOverview(d) {
    var s = d.live, srv = d.server, mem = srv.memory;
    var cards = [
      ['Uptime', fmtUptime(srv.uptimeMs), 'node ' + esc(srv.nodeVersion)],
      ['Requests', fmtNum(s.total), s.success + ' ok / ' + s.error + ' err'],
      ['Requests / min', fmtNum(s.requestsPerMinute), 'rolling 60s'],
      ['Total tokens', fmtNum(s.totalTokens), fmtNum(s.promptTokens) + ' in / ' + fmtNum(s.completionTokens) + ' out'],
    ];
    var cardsHtml = cards.map(function(c){ return '<div class="card"><div class="k">'+c[0]+'</div><div class="v">'+esc(c[1])+'</div><div class="sub">'+esc(c[2])+'</div></div>'; }).join('');
    var latency = (s.avgLatencyMs==null?'\u2014':s.avgLatencyMs+' ms') + ' avg / ' + (s.p95LatencyMs==null?'\u2014':s.p95LatencyMs+' ms') + ' p95';
    return '<h1>Overview</h1><p class="lede">Live server health and relay activity. Token figures marked estimate are computed locally; provider-reported usage is authoritative.</p>' +
      '<div class="grid cards">'+cardsHtml+'</div>' +
      '<div class="panel"><h2>System</h2><dl class="kv">' +
      '<dt>Environment</dt><dd>'+esc(srv.env)+'</dd>' +
      '<dt>Latency</dt><dd>'+esc(latency)+'</dd>' +
      '<dt>Rate limited</dt><dd>'+esc(s.rateLimited)+'</dd>' +
      '<dt>Fallbacks</dt><dd>'+esc(s.fallback)+'</dd>' +
      '<dt>Compression fallbacks</dt><dd>'+esc(s.compressionFallbacks)+'</dd>' +
      '<dt>RSS</dt><dd>'+esc(fmtBytes(mem.rssBytes))+'</dd>' +
      '<dt>Heap used</dt><dd>'+esc(fmtBytes(mem.heapUsedBytes))+'</dd>' +
      '</dl><div class="row" style="margin-top:16px"><button class="btn danger" id="resetram">Reset RAM</button><span class="muted" style="font-size:12px">Clears disposable caches only. Does not erase configuration, credentials, keys, or history. Does not restart the server.</span></div>' +
      '<div id="resetresult" style="margin-top:12px"></div></div>';
  }

  function viewProviders(d) {
    var ps = d.providers || [];
    if (!ps.length) return '<h1>Providers</h1><p class="lede">Add a custom provider. Provider API keys are entered here and encrypted at rest; they are never placed in the environment.</p>' +
      '<div class="empty">No providers configured yet.</div>' + providerForm();
    var list = ps.map(function(p){
      var creds = (p.credentials||[]).map(function(c){ return '<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"><span class="mono">'+esc(c.label)+' <span class="pill mute">'+esc(c.keyHint||'')+'</span> '+(c.isFallback?'<span class="pill info">fallback</span>':'')+'</span><button class="btn ghost" data-delcred="'+c.id+'" data-prov="'+p.id+'">Delete</button></div>'; }).join('') || '<div class="muted" style="font-size:13px">No credential stored.</div>';
      return '<div class="panel"><div class="row" style="justify-content:space-between;align-items:flex-start">' +
        '<div><h2>'+esc(p.name)+'</h2><div class="muted mono" style="font-size:12px">'+esc(p.baseUrl)+'</div></div>' +
        '<div class="row">'+pill(p.enabled?'success':'warn').replace('success','ok').replace(/ok/,'ok')+'<span class="pill '+(p.enabled?'ok':'warn')+'">'+(p.enabled?'enabled':'disabled')+'</span>' +
        '<button class="btn ghost" data-test="'+p.id+'">Test request</button>' +
        '<button class="btn ghost" data-delprov="'+p.id+'">Delete</button></div></div>' +
        '<dl class="kv" style="margin:14px 0"><dt>Models</dt><dd>'+esc((p.models||[]).join(', ')||'\u2014')+'</dd>' +
        '<dt>Format</dt><dd>'+esc(p.apiFormat)+'</dd><dt>Auth</dt><dd>'+esc(p.authStyle)+'</dd></dl>' +
        '<h2 style="font-size:13px;color:var(--muted)">Credentials</h2>'+creds+ addCredForm(p.id) +'</div>';
    }).join('');
    return '<h1>Providers</h1><p class="lede">Custom providers expose OpenAI-compatible Chat Completions. Enter credentials through the form; they are encrypted with AES-256-GCM before storage.</p>' + list + providerForm();
  }

  function addCredForm(providerId) {
    return '<form class="row" data-addcred="'+providerId+'" style="margin-top:12px;gap:8px;flex-wrap:wrap">' +
      '<input style="flex:2;min-width:180px" name="label" placeholder="label (e.g. primary)" />' +
      '<input style="flex:3;min-width:220px" name="apiKey" type="password" placeholder="Provider API key" />' +
      '<label class="row" style="gap:6px;font-size:13px"><input type="checkbox" name="isFallback" style="width:auto" /> fallback</label>' +
      '<button class="btn" type="submit">Save key</button></form>';
  }

  function providerForm() {
    return '<div class="panel"><h2>Add provider</h2>' +
      '<form id="addprov">' +
      '<div class="grid cards-2">' +
      '<label class="field"><span>Name</span><input name="name" placeholder="NVIDIA" required /></label>' +
      '<label class="field"><span>Base URL</span><input name="baseUrl" placeholder="https://integrate.api.nvidia.com/v1" required /></label>' +
      '<label class="field"><span>Auth style</span><select name="authStyle"><option value="bearer">bearer</option><option value="x-api-key">x-api-key</option></select></label>' +
      '<label class="field"><span>Models (comma separated)</span><input name="models" placeholder="nvidia/nemotron-3-ultra" /></label>' +
      '</div>' +
      '<label class="field"><span>Max output tokens</span><input name="maxOutputTokens" type="number" value="8" /></label>' +
      '<label class="row" style="gap:8px;font-size:13px"><input type="checkbox" name="allowPrivateNetwork" style="width:auto" /> Allow private-network base URL (self-hosted provider only; increases SSRF risk)</label>' +
      '<div class="row"><button class="btn" type="submit">Add provider</button></div></form>' +
      '<div id="addprovresult" style="margin-top:12px"></div></div>';
  }

  function viewKeys(d) {
    var keys = d.keys || [];
    var list = keys.map(function(k){
      return '<tr><td class="mono">'+esc(k.name)+'</td><td class="mono">'+esc(k.prefix)+'\u2026</td><td>'+(k.enabled&&!k.revokedAt?'<span class="pill ok">active</span>':'<span class="pill warn">revoked</span>')+'</td><td class="mono">'+(k.lastUsedAt?esc(new Date(k.lastUsedAt).toLocaleString()):'\u2014')+'</td><td><div class="row"><button class="btn ghost" data-rotate="'+k.id+'">Rotate</button><button class="btn ghost" data-delkey="'+k.id+'">Delete</button></div></td></tr>';
    }).join('');
    return '<h1>Client keys</h1><p class="lede">Keys your Cline/OpenCode clients use to call this relay. They are shown once at creation and stored only as a peppered hash. Rotating issues a new key and revokes the old one.</p>' +
      '<div class="panel"><form id="addkey" class="row"><input name="name" placeholder="key name" style="flex:1;min-width:180px" /><input name="rateLimitRpm" type="number" placeholder="rpm (optional)" style="width:160px" /><button class="btn" type="submit">Generate key</button></form><div id="keyresult" style="margin-top:12px"></div></div>' +
      '<div class="panel">' + (keys.length ? '<table><thead><tr><th>Name</th><th>Prefix</th><th>Status</th><th>Last used</th><th></th></tr></thead><tbody>'+list+'</tbody></table>' : '<div class="empty">No client keys yet.</div>') + '</div>';
  }

  function viewUsage(d) {
    var sum = d.summary || {};
    var ev = d.events || [];
    function tokenCell(t, src){ return t==null ? '\u2014' : fmtNum(t) + (src==='estimate' ? ' <span class="pill mute">est</span>' : ''); }
    var rows = ev.map(function(e){
      return '<tr><td class="mono">'+esc(new Date(e.created_at).toLocaleString())+'</td><td class="mono">'+esc(e.kind)+'</td><td>'+pill(e.status)+'</td><td class="mono">'+esc(e.model||'\u2014')+'</td><td class="mono">'+(e.http_status||'\u2014')+'</td><td class="mono">'+tokenCell(e.total_tokens, e.token_source)+'</td><td class="mono">'+(e.latency_ms==null?'\u2014':e.latency_ms+' ms')+'</td><td class="mono" style="color:var(--err-ink)">'+esc(e.error_code||'')+'</td></tr>';
    }).join('');
    return '<h1>Usage</h1><p class="lede">Persistent usage history from SQLite. Token counts come from the provider when returned; otherwise they are marked as estimates or unavailable. Prompts and completions are never stored.</p>' +
      '<div class="grid cards">' +
      card('Total', fmtNum(sum.total||0)) + card('Successful', fmtNum(sum.success||0)) + card('Errors', fmtNum(sum.error||0)) + card('Tokens', fmtNum(sum.total_tokens||0)) +
      '</div>' +
      '<div class="panel">' + (ev.length ? '<table><thead><tr><th>Time</th><th>Kind</th><th>Status</th><th>Model</th><th>HTTP</th><th>Tokens</th><th>Latency</th><th>Error</th></tr></thead><tbody>'+rows+'</tbody></table>' : '<div class="empty">No usage recorded yet.</div>') + '</div>';
  }
  function card(k, v){ return '<div class="card"><div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div></div>'; }

  function viewContext(d) {
    var s = d.settings || {};
    return '<h1>Context engine</h1><p class="lede">Filters and compresses conversation context before forwarding, to reduce input tokens while preserving required information. Semantic summarization is disabled by default and never uses a paid API unless explicitly enabled.</p>' +
      '<div class="panel"><form id="ctxform">' +
      '<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" name="enabled" style="width:auto" '+(s.enabled?'checked':'')+' /> Enable context filtering</label>' +
      '<label class="field" style="margin-top:14px"><span>Compression mode</span><select name="mode"><option value="off"'+(s.mode==='off'?' selected':'')+'>off (forward original)</option><option value="safe"'+(s.mode==='safe'?' selected':'')+'>safe (conservative)</option><option value="smart"'+(s.mode==='smart'?' selected':'')+'>smart (aggressive + validation)</option></select></label>' +
      '<div class="grid cards-2">' +
      '<label class="field"><span>Min savings ratio (0-1)</span><input name="minSavingsRatio" type="number" step="0.01" value="'+(s.minSavingsRatio!=null?s.minSavingsRatio:0.05)+'" /></label>' +
      '<label class="field"><span>Max retained history (messages)</span><input name="maxRetainedHistory" type="number" value="'+(s.maxRetainedHistory!=null?s.maxRetainedHistory:200)+'" /></label>' +
      '</div>' +
      '<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" name="semanticSummarization" style="width:auto" '+(s.semanticSummarization?'checked':'')+' /> Enable local semantic compression (heuristic, off by default)</label>' +
      '<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" name="safeFallback" style="width:auto" '+(s.safeFallback!==false?'checked':'')+' /> Safe fallback to original on validation failure</label>' +
      '<div class="row" style="margin-top:16px"><button class="btn" type="submit">Save settings</button></div></form>' +
      '<div id="ctxresult" style="margin-top:12px"></div></div>';
  }

  function viewSettings(d) {
    return '<h1>Security</h1><p class="lede">Account and transport security. All administrative endpoints enforce authentication and CSRF server-side.</p>' +
      '<div class="panel"><h2>Change password</h2>' +
      '<form id="pwform">' +
      '<label class="field"><span>Current password</span><input type="password" name="currentPassword" required /></label>' +
      '<label class="field"><span>New password (min 12 chars)</span><input type="password" name="newPassword" required /></label>' +
      '<div class="row"><button class="btn" type="submit">Update password</button></div></form>' +
      '<div id="pwresult" style="margin-top:12px"></div></div>' +
      '<div class="panel"><h2>Threat model</h2><p class="muted" style="font-size:13px">Provider keys are encrypted at rest (AES-256-GCM) and only decrypted server-side. Sessions use HttpOnly, SameSite=Strict cookies with CSRF tokens. SSRF protection blocks private, loopback, link-local, and cloud-metadata destinations. Losing RELAY_ENCRYPTION_KEY makes stored provider credentials unrecoverable. See docs/THREAT_MODEL.md.</p></div>';
  }

  async function route() {
    if (!state.authed) { return boot(); }
    var loaders = {
      overview: function(){ return api('/api/admin/overview').then(function(d){ state.data.overview = d; return viewOverview(d); }); },
      providers: function(){ return api('/api/admin/providers').then(function(d){ state.data.providers = d; return viewProviders(d); }); },
      keys: function(){ return api('/api/admin/keys').then(function(d){ state.data.keys = d; return viewKeys(d); }); },
      usage: function(){ return api('/api/admin/usage?limit=100').then(function(d){ state.data.usage = d; return viewUsage(d); }); },
      context: function(){ return api('/api/admin/context/stats').then(function(d){ return viewContext(d); }); },
      settings: function(){ return viewSettings({}); },
    };
    root.innerHTML = shell('<div class="empty"><span class="spinner"></span> Loading\u2026</div>');
    bindShell();
    try {
      var html = await loaders[state.tab]();
      root.innerHTML = shell(html);
      bindShell();
      bindTab();
    } catch (err) {
      if (/Authentication required/i.test(err.message)) { state.authed = false; state.csrf=''; return boot(); }
      root.innerHTML = shell(msg('err', err.message));
      bindShell();
    }
  }

  function bindTab() {
    // Overview: reset ram
    var rr = document.getElementById('resetram');
    if (rr) rr.addEventListener('click', async function(){
      var out = document.getElementById('resetresult');
      rr.disabled = true; out.innerHTML = '<span class="spinner"></span>';
      try { var r = await api('/api/admin/cache/reset', { method:'POST', body:{} });
        out.innerHTML = msg('ok', 'Cleared: ' + (r.cleared||[]).join(', ') + '. Preserved: ' + (r.preserved||[]).join(', ') + '.');
      } catch(e){ out.innerHTML = msg('err', e.message); rr.disabled=false; }
    });
    // Providers: add
    var ap = document.getElementById('addprov');
    if (ap) ap.addEventListener('submit', async function(e){
      e.preventDefault();
      var fd = new FormData(ap);
      var body = {
        name: fd.get('name'), baseUrl: fd.get('baseUrl'), authStyle: fd.get('authStyle'),
        models: String(fd.get('models')||'').split(',').map(function(x){return x.trim();}).filter(Boolean),
        maxOutputTokens: Number(fd.get('maxOutputTokens'))||8,
        allowPrivateNetwork: fd.get('allowPrivateNetwork') ? true : false,
      };
      try { await api('/api/admin/providers', { method:'POST', body: body }); state.tab='providers'; route(); }
      catch(err){ document.getElementById('addprovresult').innerHTML = msg('err', err.message); }
    });
    // Credential add forms
    root.querySelectorAll('form[data-addcred]').forEach(function(f){
      f.addEventListener('submit', async function(e){
        e.preventDefault(); var fd = new FormData(f);
        var pid = f.getAttribute('data-addcred');
        try { await api('/api/admin/providers/'+pid+'/credentials', { method:'POST', body:{ label: fd.get('label')||'primary', apiKey: fd.get('apiKey'), isFallback: !!fd.get('isFallback') } }); state.tab='providers'; route(); }
        catch(err){ alert(err.message); }
      });
    });
    // Test request
    root.querySelectorAll('button[data-test]').forEach(function(b){
      b.addEventListener('click', function(){ runTest(b.getAttribute('data-test')); });
    });
    root.querySelectorAll('button[data-delprov]').forEach(function(b){ b.addEventListener('click', async function(){ if(!confirm('Delete this provider and its credentials?'))return; try{ await api('/api/admin/providers/'+b.getAttribute('data-delprov'), { method:'DELETE' }); route(); }catch(e){alert(e.message);} }); });
    root.querySelectorAll('button[data-delcred]').forEach(function(b){ b.addEventListener('click', async function(){ var pid=b.getAttribute('data-prov'); try{ await api('/api/admin/providers/'+pid+'/credentials/'+b.getAttribute('data-delcred'), { method:'DELETE' }); route(); }catch(e){alert(e.message);} }); });
    // Keys
    var ak = document.getElementById('addkey');
    if (ak) ak.addEventListener('submit', async function(e){
      e.preventDefault(); var fd = new FormData(ak);
      try { var r = await api('/api/admin/keys', { method:'POST', body:{ name: fd.get('name')||'client', rateLimitRpm: fd.get('rateLimitRpm')?Number(fd.get('rateLimitRpm')):null } });
        document.getElementById('keyresult').innerHTML = msg('ok', 'New client key (shown once). Copy it now: ' ) + '<pre>'+esc(r.key.rawKey)+'</pre>';
        route();
      } catch(err){ document.getElementById('keyresult').innerHTML = msg('err', err.message); }
    });
    root.querySelectorAll('button[data-rotate]').forEach(function(b){ b.addEventListener('click', async function(){ try{ var r=await api('/api/admin/keys/'+b.getAttribute('data-rotate')+'/rotate',{method:'POST',body:{}}); alert('New key (shown once):\n'+r.key.rawKey); route(); }catch(e){alert(e.message);} }); });
    root.querySelectorAll('button[data-delkey]').forEach(function(b){ b.addEventListener('click', async function(){ try{ await api('/api/admin/keys/'+b.getAttribute('data-delkey'), { method:'DELETE' }); route(); }catch(e){alert(e.message);} }); });
    // Context form
    var cf = document.getElementById('ctxform');
    if (cf) cf.addEventListener('submit', async function(e){
      e.preventDefault(); var fd = new FormData(cf);
      var body = { context: {
        enabled: !!fd.get('enabled'), mode: fd.get('mode'),
        minSavingsRatio: Number(fd.get('minSavingsRatio')),
        maxRetainedHistory: Number(fd.get('maxRetainedHistory')),
        semanticSummarization: !!fd.get('semanticSummarization'),
        safeFallback: !!fd.get('safeFallback'),
      } };
      try { await api('/api/admin/settings', { method:'PATCH', body: body }); document.getElementById('ctxresult').innerHTML = msg('ok','Settings saved.'); }
      catch(err){ document.getElementById('ctxresult').innerHTML = msg('err', err.message); }
    });
    // Password form
    var pf = document.getElementById('pwform');
    if (pf) pf.addEventListener('submit', async function(e){
      e.preventDefault(); var fd = new FormData(pf);
      try { await api('/api/auth/password', { method:'POST', body:{ currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') } }); document.getElementById('pwresult').innerHTML = msg('ok','Password updated.'); pf.reset(); }
      catch(err){ document.getElementById('pwresult').innerHTML = msg('err', err.message); }
    });
  }

  function runTest(providerId) {
    var model = window.prompt('Model to test (must be configured for this provider):', 'nvidia/nemotron-3-ultra');
    if (!model) return;
    var promptText = window.prompt('Prompt to send:', 'Reply with exactly: OK');
    if (promptText == null) return;
    api('/api/admin/providers/'+providerId+'/test', { method:'POST', body:{ model: model, prompt: promptText } }).then(function(r){
      var usage = r.usage ? ('prompt '+(r.usage.promptTokens==null?'\u2014':r.usage.promptTokens)+' / completion '+(r.usage.completionTokens==null?'\u2014':r.usage.completionTokens)+' / total '+(r.usage.totalTokens==null?'\u2014':r.usage.totalTokens)+' ('+esc(r.usage.source||'')+')') : 'unavailable';
      var out = '<div class="panel"><h2>Test result</h2>' +
        (r.success ? msg('ok','HTTP ' + r.httpStatus + ' in ' + r.latencyMs + ' ms. Output: ' + JSON.stringify(r.outputText) + '. Matches "OK": ' + r.matchesExpectation) : msg('err', (r.error?r.error.code:'ERROR') + ': ' + (r.error?r.error.message:''))) +
        '<dl class="kv"><dt>Usage</dt><dd>'+usage+'</dd><dt>Request id</dt><dd>'+esc(r.requestId||'\u2014')+'</dd></dl></div>';
      var c = document.createElement('div'); c.innerHTML = out; document.querySelector('main').prepend(c);
    }).catch(function(e){ alert('Test failed: ' + e.message); });
  }

  async function boot() {
    try { var st = await api('/api/auth/status'); }
    catch(e){ renderLogin(false, msg('err','Cannot reach server.')); return; }
    if (state.authed) { return route(); }
    if (st && st.setupRequired) { return renderLogin(true); }
    return renderLogin(false);
  }

  boot();
})();
