// HUAN RELAY dashboard client. Talks only to the backend API.
// No third-party libraries, no emoji, no icon fonts: inline SVG only (CSP-safe).
(function () {
  'use strict';
  var state = { authed: false, tab: 'overview', csrf: '', lang: 'en', data: {}, masterKeyShown: null };
  var root = document.getElementById('root');

  /* ------------------------------- i18n ------------------------------- */
  var I18N = {
    en: {
      'brand.tag': 'AI API gateway',
      'nav.overview': 'Overview', 'nav.charts': 'Charts', 'nav.providers': 'Providers',
      'nav.master': 'Master key', 'nav.scoreboard': 'Scoreboard', 'nav.usage': 'Usage',
      'nav.context': 'Context engine', 'nav.settings': 'Settings',
      'login.setup.title': 'Create administrator', 'login.setup.lede': 'Set a strong administrator password (min 12 characters) to begin.',
      'login.title': 'Sign in', 'login.lede': 'Enter your administrator password.',
      'login.pw': 'Password', 'login.submit.setup': 'Create account', 'login.submit': 'Sign in',
      'login.offline': 'Cannot reach server.',
      'err.generic': 'Something went wrong.',
      'loading': 'Loading...',
      'ov.title': 'Overview', 'ov.lede': 'Live gateway activity and persistent usage totals.',
      'ov.uptime': 'Uptime', 'ov.rpm': 'Requests / min', 'ov.liveReq': 'Live requests', 'ov.totalReq': 'Total requests',
      'ov.success': 'Success', 'ov.errors': 'Errors', 'ov.limited': 'Rate limited', 'ov.fallback': 'Fallback',
      'ov.tokens': 'Tokens (total)', 'ov.avgLatency': 'Avg latency', 'ov.p95': 'p95 latency',
      'ov.node': 'Node', 'ov.env': 'Environment', 'ov.rss': 'Memory (RSS)', 'ov.caches': 'Caches',
      'ov.chart.title': 'Requests per hour (last 24 h)',
      'ov.chart.total': 'Total requests in chart',
      'chart.requests': 'requests', 'chart.nodata': 'No request data yet. Traffic will appear here once clients call the relay.',
      'chart.legend': 'Bars show the number of requests per hourly bucket. Labels above bars are exact counts.',
      'ch.title': 'Charts', 'ch.lede': 'Request volume over time with exact counts, plus status breakdown.',
      'ch.breakdown': 'Status breakdown',
      'ch.range.1h': 'Last hour', 'ch.range.24h': 'Last 24 hours', 'ch.range.7d': 'Last 7 days', 'ch.range.all': 'All time',
      'pv.title': 'Providers', 'pv.lede': 'Upstream AI providers. Each request forwarded through the relay can carry the attached prompt configured here.',
      'pv.add': 'Add provider', 'pv.name': 'Name', 'pv.url': 'Base URL', 'pv.key': 'API key',
      'pv.models': 'Models (comma separated)', 'pv.maxOut': 'Max output tokens',
      'pv.prompt': 'Attached prompt',
      'pv.prompt.hint': 'Optional. This text is appended as a system message to every request relayed to this provider.',
      'pv.prompt.none': 'No attached prompt',
      'pv.prompt.edit': 'Edit prompt', 'pv.prompt.save': 'Save prompt', 'pv.prompt.cancel': 'Cancel', 'pv.prompt.saved': 'Attached prompt saved.',
      'pv.allowPrivate': 'Allow private network addresses (HTTP mocks / LAN only)',
      'pv.submit': 'Add provider', 'pv.empty': 'No providers yet. Add one to start relaying.',
      'pv.creds': 'API keys', 'pv.cred.add': 'Add key', 'pv.cred.label': 'Label', 'pv.cred.key': 'API key',
      'pv.cred.fallback': 'Fallback', 'pv.cred.empty': 'No keys stored.',
      'pv.test': 'Test', 'pv.test.model': 'Model', 'pv.test.prompt': 'Test prompt',
      'pv.test.run': 'Run test', 'pv.test.result': 'Test result', 'pv.test.noModels': 'Add at least one model to this provider first.',
      'pv.delete': 'Delete', 'pv.delete.confirm': 'Delete this provider and its credentials?',
      'pv.masterKey': 'Master key',
      'mk.title': 'Master key',
      'mk.lede': 'One key for every client. The gateway load-balances across all enabled provider keys, so clients never need a provider key or a model name.',
      'mk.create': 'Create master key', 'mk.rotate': 'Rotate master key',
      'mk.exists': 'Master key', 'mk.prefix': 'Prefix', 'mk.lastUsed': 'Last used', 'mk.url': 'Relay URL',
      'mk.none': 'No master key yet. Add a provider API key first, then create the master key.',
      'mk.warn': 'Copy it now. It will not be shown again.',
      'sb.title': 'Scoreboard', 'sb.lede': 'Per-credential traffic, ranked by request count.',
      'sb.provider': 'Provider', 'sb.cred': 'Key', 'sb.req': 'Requests', 'sb.ok': 'Success', 'sb.err': 'Errors',
      'sb.tokens': 'Tokens', 'sb.avg': 'Avg latency', 'sb.last': 'Last used', 'sb.empty': 'No recorded requests yet.',
      'us.title': 'Usage', 'us.lede': 'Persistent usage history and diagnostics recorded by the relay.',
      'us.events': 'Recent events', 'us.time': 'Time', 'us.kind': 'Kind', 'us.model': 'Model', 'us.status': 'Status',
      'us.http': 'HTTP', 'us.latency': 'Latency', 'us.errCode': 'Error',
      'us.diag': 'Diagnostics', 'us.diag.kind': 'Kind', 'us.diag.detail': 'Detail', 'us.diag.time': 'Time',
      'us.empty': 'No usage events recorded yet.', 'us.diag.empty': 'No diagnostics recorded.',
      'ctx.title': 'Context engine',
      'ctx.lede': 'Optional token-saving processing applied before forwarding. Disabled by default; safe fallback always applies.',
      'ctx.enabled': 'Enabled', 'ctx.mode': 'Mode', 'ctx.minSavings': 'Minimum savings ratio',
      'ctx.maxHist': 'Max retained history messages', 'ctx.sematic': 'Semantic summarization',
      'ctx.safeFallback': 'Safe fallback to original request on failure',
      'ctx.save': 'Save settings', 'ctx.saved': 'Settings saved.',
      'st.title': 'Settings', 'st.lede': 'Dashboard preferences and administrator security.',
      'st.language': 'Language',
      'st.pw.title': 'Change password', 'st.pw.current': 'Current password', 'st.pw.new': 'New password (min 12 chars)',
      'st.pw.save': 'Update password', 'st.pw.saved': 'Password updated.',
      'test.usage': 'Usage', 'test.reqId': 'Request id',
      'status.success': 'success', 'status.fallback': 'fallback', 'status.error': 'error', 'status.rate_limited': 'rate limited',
      'logout': 'Sign out',
    },
    vi: {
      'brand.tag': 'Cổng AI API',
      'nav.overview': 'Tổng quan', 'nav.charts': 'Biểu đồ', 'nav.providers': 'Nhà cung cấp',
      'nav.master': 'Khoá chính', 'nav.scoreboard': 'Bảng xếp hạng', 'nav.usage': 'Sử dụng',
      'nav.context': 'Bộ lọc ngữ cảnh', 'nav.settings': 'Cài đặt',
      'login.setup.title': 'Tạo quản trị viên', 'login.setup.lede': 'Đặt mật khẩu quản trị viên mạnh (tối thiểu 12 ký tự) để bắt đầu.',
      'login.title': 'Đăng nhập', 'login.lede': 'Nhập mật khẩu quản trị viên.',
      'login.pw': 'Mật khẩu', 'login.submit.setup': 'Tạo tài khoản', 'login.submit': 'Đăng nhập',
      'login.offline': 'Không kết nối được với máy chủ.',
      'err.generic': 'Đã xảy ra lỗi.',
      'loading': 'Đang tải...',
      'ov.title': 'Tổng quan', 'ov.lede': 'Hoạt động cổng trực tuyến và tổng sử dụng lưu trữ.',
      'ov.uptime': 'Thời gian hoạt động', 'ov.rpm': 'Request / phút', 'ov.liveReq': 'Request trực tuyến', 'ov.totalReq': 'Tổng request',
      'ov.success': 'Thành công', 'ov.errors': 'Lỗi', 'ov.limited': 'Bị giới hạn tốc độ', 'ov.fallback': 'Chuyển đổi',
      'ov.tokens': 'Token (tất cả)', 'ov.avgLatency': 'Độ trễ trung bình', 'ov.p95': 'Độ trễ p95',
      'ov.node': 'Node', 'ov.env': 'Môi trường', 'ov.rss': 'Bộ nhớ (RSS)', 'ov.caches': 'Bộ nhớ đệm',
      'ov.chart.title': 'Số request mỗi giờ (24 giờ qua)',
      'ov.chart.total': 'Tổng request trong biểu đồ',
      'chart.requests': 'request', 'chart.nodata': 'Chưa có dữ liệu request. Lượng gọi sẽ hiển thị tại đây khi client gọi vào cổng.',
      'chart.legend': 'Cột thể hiện số request mỗi khung giờ. Số trên từng cột là số chính xác.',
      'ch.title': 'Biểu đồ', 'ch.lede': 'Lượng request theo thời gian kèm số chính xác, và phân loại trạng thái.',
      'ch.breakdown': 'Phân loại trạng thái',
      'ch.range.1h': '1 giờ qua', 'ch.range.24h': '24 giờ qua', 'ch.range.7d': '7 ngày qua', 'ch.range.all': 'Tất cả',
      'pv.title': 'Nhà cung cấp',
      'pv.lede': 'Nhà cung cấp AI upstream. Mỗi request đi qua cổng có thể kèm đoạn prompt định sẵn đã cấu hình tại đây.',
      'pv.add': 'Thêm nhà cung cấp', 'pv.name': 'Tên', 'pv.url': 'Base URL', 'pv.key': 'API key',
      'pv.models': 'Model (ngăn bằng dấu phẩy)', 'pv.maxOut': 'Số token đầu ra tối đa',
      'pv.prompt': 'Prompt định kèm',
      'pv.prompt.hint': 'Tùy chọn. Văn bản này được thêm vào cuối mọi request gửi tới nhà cung cấp (vai trò system).',
      'pv.prompt.none': 'Chưa có prompt định kèm',
      'pv.prompt.edit': 'Sửa prompt', 'pv.prompt.save': 'Lưu prompt', 'pv.prompt.cancel': 'Huỷ', 'pv.prompt.saved': 'Đã lưu prompt định kèm.',
      'pv.allowPrivate': 'Cho phép địa chỉ mạng nội bộ (chỉ dùng cho mock/LAN)',
      'pv.submit': 'Thêm nhà cung cấp', 'pv.empty': 'Chưa có nhà cung cấp. Thêm một cái để bắt đầu chuyển tiếp.',
      'pv.creds': 'API key', 'pv.cred.add': 'Thêm key', 'pv.cred.label': 'Nhãn', 'pv.cred.key': 'API key',
      'pv.cred.fallback': 'Dự phòng', 'pv.cred.empty': 'Chưa lưu key nào.',
      'pv.test': 'Thử', 'pv.test.model': 'Model', 'pv.test.prompt': 'Prompt thử',
      'pv.test.run': 'Chạy thử', 'pv.test.result': 'Kết quả thử', 'pv.test.noModels': 'Hãy thêm ít nhất một model cho nhà cung cấp này trước.',
      'pv.delete': 'Xoá', 'pv.delete.confirm': 'Xoá nhà cung cấp này và các key của nó?',
      'pv.masterKey': 'Khoá chính',
      'mk.title': 'Khoá chính',
      'mk.lede': 'Một khoá cho mọi client. Cổng sẽ tải cân bằng qua tất cả key nhà cung cấp đang bật, nên client không cần key nhà cung cấp hay tên model.',
      'mk.create': 'Tạo khoá chính', 'mk.rotate': 'Xoay khoá chính',
      'mk.exists': 'Khoá chính', 'mk.prefix': 'Tiền tố', 'mk.lastUsed': 'Dùng lần cuối', 'mk.url': 'URL cổng',
      'mk.none': 'Chưa có khoá chính. Thêm API key nhà cung cấp trước, rồi tạo khoá chính.',
      'mk.warn': 'Sao lưu ngay. Sẽ không hiển thị lại lần nữa.',
      'sb.title': 'Bảng xếp hạng', 'sb.lede': 'Lưu lượng theo từng key, xếp theo số request.',
      'sb.provider': 'Nhà cung cấp', 'sb.cred': 'Key', 'sb.req': 'Request', 'sb.ok': 'Thành công', 'sb.err': 'Lỗi',
      'sb.tokens': 'Token', 'sb.avg': 'Độ trễ TB', 'sb.last': 'Lần cuối', 'sb.empty': 'Chưa có request nào được ghi lại.',
      'us.title': 'Sử dụng', 'us.lede': 'Lịch sử sử dụng lưu trữ và chẩn đoán do cổng ghi lại.',
      'us.events': 'Sự kiện gần đây', 'us.time': 'Thời gian', 'us.kind': 'Loại', 'us.model': 'Model', 'us.status': 'Trạng thái',
      'us.http': 'HTTP', 'us.latency': 'Độ trễ', 'us.errCode': 'Lỗi',
      'us.diag': 'Chẩn đoán', 'us.diag.kind': 'Loại', 'us.diag.detail': 'Chi tiết', 'us.diag.time': 'Thời gian',
      'us.empty': 'Chưa có sự kiện sử dụng nào.', 'us.diag.empty': 'Chưa có chẩn đoán nào.',
      'ctx.title': 'Bộ lọc ngữ cảnh',
      'ctx.lede': 'Xử lý tiết kiệm token tùy chọn trước khi chuyển tiếp. Tắt theo mặc định; luôn có đường lui an toàn.',
      'ctx.enabled': 'Bật', 'ctx.mode': 'Chế độ', 'ctx.minSavings': 'Tỷ lệ tiết kiệm tối thiểu',
      'ctx.maxHist': 'Số tin nhắn lịch sử tối đa', 'ctx.sematic': 'Tóm tắt ngữ nghĩa',
      'ctx.safeFallback': 'Quay về bản gốc khi xử lý thất bại',
      'ctx.save': 'Lưu cài đặt', 'ctx.saved': 'Đã lưu cài đặt.',
      'st.title': 'Cài đặt', 'st.lede': 'Tùy thích bảng điều khiển và bảo mật quản trị viên.',
      'st.language': 'Ngôn ngữ',
      'st.pw.title': 'Đổi mật khẩu', 'st.pw.current': 'Mật khẩu hiện tại', 'st.pw.new': 'Mật khẩu mới (tối thiểu 12 ký tự)',
      'st.pw.save': 'Cập nhật mật khẩu', 'st.pw.saved': 'Đã cập nhật mật khẩu.',
      'test.usage': 'Sử dụng', 'test.reqId': 'Request id',
      'status.success': 'thành công', 'status.fallback': 'chuyển đổi', 'status.error': 'lỗi', 'status.rate_limited': 'bị giới hạn',
      'logout': 'Đăng xuất',
    },
  };
  function t(key) {
    var d = I18N[state.lang] || I18N.en;
    if (d[key] != null) return d[key];
    if (I18N.en[key] != null) return I18N.en[key];
    return key;
  }
  function saveLang(lang) { try { localStorage.setItem('huan-relay-lang', lang); } catch (e) {} }
  function loadLang() {
    var stored = null;
    try { stored = localStorage.getItem('huan-relay-lang'); } catch (e) {}
    if (stored === 'en' || stored === 'vi') return stored;
    try { if ((navigator.language || '').toLowerCase().indexOf('vi') === 0) return 'vi'; } catch (e) {}
    return 'en';
  }
  state.lang = loadLang();

  /* ------------------------------ SVG logos ------------------------------ */
  var LOGO_BRAND = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
    '<rect x="2" y="2" width="44" height="44" rx="12" fill="#0d9488"/>' +
    '<path d="M14 30 L22 16 L26 24 L30 18 L34 30" stroke="#ffffff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '<circle cx="24" cy="34" r="2.4" fill="#ffffff"/></svg>';
  var TAB_ICONS = {
    overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    charts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 20 V10"/><path d="M10 20 V4"/><path d="M16 20 V13"/><path d="M22 20 H2"/></svg>',
    providers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5 h.01 M7 16.5 h.01"/></svg>',
    master: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="14" r="4.5"/><path d="M11.5 10.5 L20 3 M17 6 l2.5 2.5 M14.5 8.5 l2 2"/></svg>',
    scoreboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21 h8 M12 17 v4"/><path d="M6 4 h12 v5 a6 6 0 0 1-12 0 Z"/><path d="M6 6 H3 a3 3 0 0 0 3 4 M18 6 h3 a3 3 0 0 1-3 4"/></svg>',
    usage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12 h4 l2-6 4 12 2-6 h6"/></svg>',
    context: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 l9 5-9 5-9-5 9-5 Z"/><path d="M3 13 l9 5 9-5"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3H9.8l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2 Z"/></svg>',
  };

  /* ------------------------------- Helpers ------------------------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) { if (n == null) return '\u2014'; if (n >= 1e9) return (n/1e9).toFixed(1)+'B'; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'k'; return String(n); }
  function fmtUptime(ms) { var s = Math.floor(ms/1000); var h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60; return h+'h '+m+'m '+sec+'s'; }
  function fmtBytes(b){ if(b==null) return '\u2014'; var u=['B','KB','MB','GB'], i=0; while(b>=1024&&i<u.length-1){b/=1024;i++;} return b.toFixed(1)+' '+u[i]; }
  function fmtTime(iso) { if (!iso) return '\u2014'; try { return new Date(iso).toLocaleString(state.lang === 'vi' ? 'vi-VN' : 'en-GB'); } catch (e) { return esc(iso); } }

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
    if (!res.ok) { var m = (json && json.error && json.error.message) || ('HTTP ' + res.status); throw new Error(m); }
    return json;
  }

  function msg(kind, text) { return '<div class="msg ' + kind + '">' + esc(text) + '</div>'; }
  function pill(status) {
    var map = { success:'ok', fallback:'info', error:'err', rate_limited:'warn' };
    var cls = map[status] || 'mute';
    var label = (I18N[state.lang] && I18N[state.lang]['status.' + status]) || I18N.en['status.' + status] || status;
    return '<span class="pill ' + cls + '">' + esc(label) + '</span>';
  }
  function boolPill(on, onLabel, offLabel) {
    return on ? '<span class="pill ok">' + esc(onLabel) + '</span>' : '<span class="pill mute">' + esc(offLabel) + '</span>';
  }
  function card(k, v, sub) {
    return '<div class="card"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  /* ------------------------------- Views ------------------------------- */
  function brandBlock(sub) {
    return '<div class="brand">' + LOGO_BRAND + '<div class="bt"><b>HUAN RELAY</b><span>' + esc(sub || t('brand.tag')) + '</span></div></div>';
  }
  function langSwitchHtml() {
    return '<div class="langswitch" role="group" aria-label="' + esc(t('st.language')) + '">' +
      '<button type="button" data-lang="en" class="' + (state.lang === 'en' ? 'active' : '') + '">EN</button>' +
      '<button type="button" data-lang="vi" class="' + (state.lang === 'vi' ? 'active' : '') + '">VI</button></div>';
  }

  function renderLogin(setupRequired, banner) {
    root.innerHTML =
      '<div class="login-shell">' + brandBlock() +
      '<div class="panel">' +
      '<h1 style="font-size:1.3rem">' + esc(setupRequired ? t('login.setup.title') : t('login.title')) + '</h1>' +
      '<p class="lede">' + esc(setupRequired ? t('login.setup.lede') : t('login.lede')) + '</p>' +
      '<div class="row" style="justify-content:flex-end;margin-bottom:12px">' + langSwitchHtml() + '</div>' +
      (banner || '') +
      '<form id="authform">' +
      '<label class="field"><span>' + esc(t('login.pw')) + '</span><input type="password" id="pw" autocomplete="current-password" required /></label>' +
      '<div class="row"><button class="btn" type="submit">' + esc(setupRequired ? t('login.submit.setup') : t('login.submit')) + '</button></div>' +
      '</form></div></div>';
    bindLangSwitch();
    document.getElementById('authform').addEventListener('submit', async function (e) {
      e.preventDefault();
      var pw = document.getElementById('pw').value;
      var btn = e.target.querySelector('button');
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
      try {
        var r = await api(setupRequired ? '/api/auth/setup' : '/api/auth/login', { method:'POST', body:{ password: pw } });
        state.csrf = r.csrfToken; state.authed = true;
        route();
      } catch (err) {
        renderLogin(setupRequired, msg('err', err.message));
      }
    });
  }

  var TABS = ['overview','charts','providers','master','scoreboard','usage','context','settings'];

  function shell(inner) {
    var nav = TABS.map(function (id) {
      return '<button type="button" data-tab="' + id + '" class="' + (state.tab === id ? 'active' : '') + '">' +
        (TAB_ICONS[id] || '') + '<span>' + esc(t('nav.' + id)) + '</span></button>';
    }).join('');
    root.innerHTML =
      '<div class="wrap">' +
      '<header class="top">' +
        brandBlock() +
        '<div class="topbar-extra">' + langSwitchHtml() +
        '<button type="button" class="btn ghost sm" id="logout">' + esc(t('logout')) + '</button></div>' +
      '</header>' +
      '<nav class="tabs">' + nav + '</nav>' +
      '<main style="margin-top:22px">' + inner + '</main>' +
      '</div>';
    root.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); route(); });
    });
    bindLangSwitch();
    var lo = document.getElementById('logout');
    if (lo) lo.addEventListener('click', async function () {
      try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (e) {}
      state.authed = false; state.csrf = ''; renderLogin(false);
    });
  }

  function bindLangSwitch() {
    root.querySelectorAll('.langswitch button').forEach(function (b) {
      b.addEventListener('click', function () {
        var lang = b.getAttribute('data-lang');
        if (lang === state.lang) return;
        state.lang = lang; saveLang(lang);
        api('/api/admin/settings', { method: 'PATCH', body: { ui: { language: lang } } })
          .catch(function () {});
        if (state.authed) route(); else renderLogin(!!(state.setupRequired), null);
      });
    });
  }

  /* ------------------------------ Charts ------------------------------ */
  function niceMax(v) {
    if (v <= 5) return 5;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var nm = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
    return nm * p;
  }

  // Labeled bar chart: value labels above bars, time labels below, y-axis max + gridlines.
  function barChart(ts, title) {
    ts = ts || [];
    var totalReqs = 0, i;
    for (i = 0; i < ts.length; i++) totalReqs += (ts[i].total || 0);
    if (!ts.length) return '<div class="chart-frame"><h2>' + esc(title) + '</h2><div class="empty">' + esc(t('chart.nodata')) + '</div></div>';
    var W = 760, H = 240, padL = 40, padR = 10, padT = 22, padB = 44;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var maxVal = 0;
    for (i = 0; i < ts.length; i++) if ((ts[i].total || 0) > maxVal) maxVal = ts[i].total;
    var yMax = niceMax(maxVal);
    var n = ts.length;
    var slot = plotW / n;
    var barW = Math.max(3, Math.min(30, slot * 0.62));
    var parts = [];
    var gridVals = [0, yMax / 2, yMax];
    for (i = 0; i < gridVals.length; i++) {
      var gy = padT + plotH - (gridVals[i] / yMax) * plotH;
      parts.push('<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="#dde5ee" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#71809a">' + Math.round(gridVals[i]) + '</text>');
    }
    var labelEvery = Math.max(1, Math.ceil(n / 12));
    for (i = 0; i < n; i++) {
      var d = ts[i] || {};
      var cnt = d.total || 0;
      var bh = yMax ? (cnt / yMax) * plotH : 0;
      var bx = padL + i * slot + (slot - barW) / 2;
      var by = padT + plotH - bh;
      var d0 = new Date(d.start);
      var hh = ('0' + d0.getHours()).slice(-2) + ':00';
      var titleTxt = hh + ' - ' + cnt + ' ' + t('chart.requests');
      parts.push('<rect x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(bh, cnt > 0 ? 2 : 0).toFixed(1) + '" rx="2" fill="#0d9488"><title>' + esc(titleTxt) + '</title></rect>');
      if (cnt > 0) {
        parts.push('<text x="' + (bx + barW / 2).toFixed(1) + '" y="' + (by - 4).toFixed(1) + '" text-anchor="middle" font-size="9.5" font-weight="600" fill="#465363">' + cnt + '</text>');
      }
      if (i % labelEvery === 0 || i === n - 1) {
        parts.push('<text x="' + (bx + barW / 2).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="9.5" fill="#71809a">' + hh + '</text>');
      }
    }
    parts.push('<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (W - padR) + '" y2="' + (padT + plotH) + '" stroke="#cfd9e5" stroke-width="1"/>');
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block" role="img" aria-label="' + esc(title) + '">' + parts.join('') + '</svg>';
    return '<div class="chart-frame">' +
      '<div class="panel-head" style="margin-bottom:4px"><h2>' + esc(title) + '</h2>' +
      '<span class="pill info">' + esc(t('ov.chart.total')) + ': ' + fmtNum(totalReqs) + '</span></div>' +
      '<p class="muted" style="font-size:12px;margin:0 0 8px">' + esc(t('chart.legend')) + '</p>' +
      svg + '</div>';
  }

  function pieChart(parts) {
    parts = parts || [];
    var total = 0, i;
    for (i = 0; i < parts.length; i++) total += parts[i].count;
    if (!total) return '<div class="empty">' + esc(t('chart.nodata')) + '</div>';
    var colors = { success: '#0d9488', fallback: '#3b82f6', error: '#dc2626', rate_limited: '#d97706' };
    var cx = 90, cy = 90, r = 70, a0 = -Math.PI / 2, s = '';
    for (i = 0; i < parts.length; i++) {
      var frac = parts[i].count / total;
      var a1 = a0 + frac * Math.PI * 2;
      var large = frac > 0.5 ? 1 : 0;
      var x0 = (cx + r * Math.cos(a0)).toFixed(1), y0 = (cy + r * Math.sin(a0)).toFixed(1);
      var x1 = (cx + r * Math.cos(a1)).toFixed(1), y1 = (cy + r * Math.sin(a1)).toFixed(1);
      var col = colors[parts[i].status] || '#94a3b8';
      var stLabel = (I18N[state.lang] && I18N[state.lang]['status.' + parts[i].status]) || I18N.en['status.' + parts[i].status] || parts[i].status;
      if (parts[i].count === total) {
        s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + col + '"><title>' + esc(stLabel + ': ' + parts[i].count) + '</title></circle>';
      } else {
        s += '<path d="M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x1 + ' ' + y1 + ' Z" fill="' + col + '"><title>' + esc(stLabel + ': ' + parts[i].count) + '</title></path>';
      }
      a0 = a1;
    }
    var leg = parts.map(function (p) {
      var lbl = (I18N[state.lang] && I18N[state.lang]['status.' + p.status]) || I18N.en['status.' + p.status] || p.status;
      return '<span class="pill mute">' + esc(lbl) + ': ' + fmtNum(p.count) + '</span>';
    }).join(' ');
    return '<svg viewBox="0 0 180 180" style="width:180px;height:auto" role="img" aria-label="' + esc(t('ch.breakdown')) + '">' + s + '</svg><div class="row" style="margin-top:10px;gap:6px">' + leg + '</div>';
  }

  function viewOverview(d) {
    var lv = d.live || {}, pr = d.persistent || {}, sv = d.server || {};
    return '<h1>' + esc(t('ov.title')) + '</h1><p class="lede">' + esc(t('ov.lede')) + '</p>' +
      '<div class="grid cards">' +
        card(t('ov.uptime'), fmtUptime(lv.uptimeMs || 0)) +
        card(t('ov.rpm'), fmtNum(lv.requestsPerMinute || 0)) +
        card(t('ov.liveReq'), fmtNum(lv.total || 0), t('ov.success') + ': ' + fmtNum(lv.success || 0)) +
        card(t('ov.totalReq'), fmtNum(pr.total || 0), t('ov.errors') + ': ' + fmtNum(pr.error || 0)) +
      '</div>' +
      '<div style="margin-top:16px">' + barChart(d.timeseries, t('ov.chart.title')) + '</div>' +
      '<div class="grid cards" style="margin-top:16px">' +
        card(t('ov.tokens'), fmtNum(pr.total_tokens || 0)) +
        card(t('ov.avgLatency'), lv.avgLatencyMs != null ? lv.avgLatencyMs + ' ms' : '\u2014') +
        card(t('ov.p95'), lv.p95LatencyMs != null ? lv.p95LatencyMs + ' ms' : '\u2014') +
        card(t('ov.limited'), fmtNum((lv.rateLimited || 0))) +
      '</div>' +
      '<div class="panel"><div class="panel-head"><h2>' + esc(t('ov.title')) + ' - ' + esc(t('ov.node')) + '</h2></div>' +
      '<dl class="kv">' +
        '<dt>' + esc(t('ov.node')) + '</dt><dd>' + esc(sv.nodeVersion || '\u2014') + '</dd>' +
        '<dt>' + esc(t('ov.env')) + '</dt><dd>' + esc(sv.env || '\u2014') + '</dd>' +
        '<dt>' + esc(t('ov.rss')) + '</dt><dd>' + fmtBytes(sv.memory && sv.memory.rssBytes) + '</dd>' +
        '<dt>' + esc(t('ov.caches')) + '</dt><dd>' + esc(JSON.stringify(d.caches || {})) + '</dd>' +
      '</dl></div>';
  }

  function viewCharts(d) {
    var lv = d.live || {};
    return '<h1>' + esc(t('ch.title')) + '</h1><p class="lede">' + esc(t('ch.lede')) + '</p>' +
      barChart(d.timeseries, t('ov.chart.title')) +
      '<div class="grid cards-2" style="margin-top:16px">' +
        '<div class="panel" style="margin-top:0"><h2>' + esc(t('ch.breakdown')) + '</h2>' + pieChart(d.breakdown) + '</div>' +
        '<div class="panel" style="margin-top:0"><h2>' + esc(t('ov.title')) + '</h2><dl class="kv">' +
          '<dt>' + esc(t('ov.liveReq')) + '</dt><dd>' + fmtNum(lv.total || 0) + '</dd>' +
          '<dt>' + esc(t('ov.rpm')) + '</dt><dd>' + fmtNum(lv.requestsPerMinute || 0) + '</dd>' +
          '<dt>' + esc(t('ov.tokens')) + '</dt><dd>' + fmtNum(lv.totalTokens || 0) + '</dd>' +
          '<dt>' + esc(t('ov.avgLatency')) + '</dt><dd>' + (lv.avgLatencyMs != null ? lv.avgLatencyMs + ' ms' : '\u2014') + '</dd>' +
        '</dl></div>' +
      '</div>';
  }

  /* ----------------------------- Providers ----------------------------- */
  function viewProviders(d) {
    var ps = d.providers || [];
    var out = '<h1>' + esc(t('pv.title')) + '</h1><p class="lede">' + esc(t('pv.lede')) + '</p>';
    out += '<div id="addprovresult"></div>';
    out += '<div class="panel"><div class="panel-head"><h2>' + esc(t('pv.add')) + '</h2></div>' +
      '<form id="addprov" class="form-grid">' +
      '<label class="field"><span>' + esc(t('pv.name')) + '</span><input name="name" required placeholder="My provider" /></label>' +
      '<label class="field"><span>' + esc(t('pv.url')) + '</span><input name="baseUrl" required placeholder="https://api.example.com/v1" /></label>' +
      '<label class="field"><span>' + esc(t('pv.key')) + '</span><input name="apiKey" placeholder="sk-..." autocomplete="off" /></label>' +
      '<label class="field"><span>' + esc(t('pv.models')) + '</span><input name="models" required placeholder="gpt-4o, gpt-4o-mini" /></label>' +
      '<label class="field full"><span>' + esc(t('pv.prompt')) + '</span><textarea name="attachedPrompt" rows="3" placeholder="' + esc(t('pv.prompt.hint')) + '"></textarea>' +
      '<div class="hint">' + esc(t('pv.prompt.hint')) + '</div></label>' +
      '<label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="allowPrivateNetwork" style="width:auto" /> <span style="margin:0">' + esc(t('pv.allowPrivate')) + '</span></label>' +
      '<div class="row" style="align-items:flex-end"><button class="btn" type="submit">' + esc(t('pv.submit')) + '</button></div>' +
      '</form></div>';

    if (!ps.length) {
      out += '<div class="panel"><div class="empty">' + esc(t('pv.empty')) + '</div></div>';
      return out;
    }
    out += '<div style="margin-top:16px">';
    ps.forEach(function (p) {
      var creds = p.credentials || [];
      out += '<div class="prov">' +
        '<div class="prov-head"><div><div class="prov-title"><b>' + esc(p.name) + '</b>' +
        boolPill(p.enabled, 'ON', 'OFF') +
        '<span class="pill mute">' + esc((p.models || []).length) + ' ' + esc(t('pv.models').split(' ')[0]) + '</span></div>' +
        '<div class="prov-meta mono">' + esc(p.baseUrl) + '</div></div>' +
        '<div class="row">' +
        '<button class="btn ghost sm" data-test="' + esc(p.id) + '">' + esc(t('pv.test')) + '</button>' +
        '<button class="btn danger sm" data-delprov="' + esc(p.id) + '">' + esc(t('pv.delete')) + '</button>' +
        '</div></div>';

      out += '<div style="margin-top:10px" class="prov-meta"><b>' + esc(t('pv.prompt')) + ':</b> ' +
        (p.attachedPrompt ? esc(p.attachedPrompt.length > 160 ? p.attachedPrompt.slice(0, 160) + '\u2026' : p.attachedPrompt) : '<span class="muted">' + esc(t('pv.prompt.none')) + '</span>') +
        ' <button class="btn ghost sm" data-editprompt="' + esc(p.id) + '">' + esc(t('pv.prompt.edit')) + '</button></div>' +
        '<form class="promptedit hidden" data-promptform="' + esc(p.id) + '" style="margin-top:8px">' +
        '<label class="field"><span>' + esc(t('pv.prompt')) + '</span><textarea name="attachedPrompt" rows="3">' + esc(p.attachedPrompt || '') + '</textarea></label>' +
        '<div class="row"><button class="btn sm" type="submit">' + esc(t('pv.prompt.save')) + '</button>' +
        '<button class="btn ghost sm" type="button" data-cancelprompt="' + esc(p.id) + '">' + esc(t('pv.prompt.cancel')) + '</button></div>' +
        '<div data-promptresult="' + esc(p.id) + '"></div></form>';

      out += '<div class="tablewrap" style="margin-top:12px">' +
        (creds.length ? '<table><thead><tr><th>' + esc(t('pv.cred.label')) + '</th><th>' + esc(t('pv.key')) + '</th><th>' + esc(t('us.status')) + '</th><th></th></tr></thead><tbody>' +
          creds.map(function (c) {
            return '<tr><td>' + esc(c.label) + (c.isFallback ? ' <span class="pill info">' + esc(t('pv.cred.fallback')) + '</span>' : '') + '</td>' +
              '<td class="mono">' + esc(c.keyHint || '\u2014') + '</td>' +
              '<td>' + boolPill(c.enabled, 'ON', 'OFF') + '</td>' +
              '<td><button class="btn danger sm" data-delcred="' + esc(c.id) + '" data-prov="' + esc(p.id) + '">' + esc(t('pv.delete')) + '</button></td></tr>';
          }).join('') + '</tbody></table>' : '<div class="empty" style="border:none">' + esc(t('pv.cred.empty')) + '</div>') + '</div>';

      out += '<form class="row" data-addcred="' + esc(p.id) + '" style="margin-top:10px">' +
        '<input name="label" placeholder="' + esc(t('pv.cred.label')) + '" style="max-width:160px" />' +
        '<input name="apiKey" placeholder="' + esc(t('pv.cred.key')) + '" required style="flex:1;min-width:200px" autocomplete="off" />' +
        '<button class="btn sm" type="submit">' + esc(t('pv.cred.add')) + '</button></form>';

      out += '<form class="row testform hidden" data-testform="' + esc(p.id) + '" style="margin-top:10px">' +
        '<select name="model" style="max-width:260px">' + (p.models || []).map(function (m) { return '<option value="' + esc(m) + '">' + esc(m) + '</option>'; }).join('') + '</select>' +
        '<input name="prompt" placeholder="' + esc(t('pv.test.prompt')) + '" value="Reply with exactly: OK" style="flex:1;min-width:180px" />' +
        '<button class="btn sm" type="submit">' + esc(t('pv.test.run')) + '</button></form>' +
        '<div data-testresult="' + esc(p.id) + '"></div>';
      out += '</div>';
    });
    out += '</div>';
    return out;
  }

  function viewMaster(d) {
    var exists = d.exists;
    var mk = d;
    var shown = state.masterKeyShown;
    var out = '<h1>' + esc(t('mk.title')) + '</h1><p class="lede">' + esc(t('mk.lede')) + '</p>';
    out += '<div id="masterresult"></div>';
    out += '<div class="panel">';
    if (shown) {
      out += msg('ok', t('mk.warn')) + '<dl class="kv">' +
        '<dt>' + esc(t('pv.key')) + '</dt><dd>' + esc(shown.rawKey) + '</dd>' +
        '<dt>' + esc(t('mk.url')) + '</dt><dd>' + esc(shown.relayUrl) + '</dd></dl>';
    } else if (exists && mk.masterKey) {
      out += '<dl class="kv">' +
        '<dt>' + esc(t('mk.exists')) + '</dt><dd>' + esc(mk.masterKey.name || 'master') + '</dd>' +
        '<dt>' + esc(t('mk.prefix')) + '</dt><dd>' + esc(mk.masterKey.prefix || '\u2014') + '</dd>' +
        '<dt>' + esc(t('us.status')) + '</dt><dd>' + boolPill(mk.masterKey.enabled, 'ON', 'OFF') + '</dd>' +
        '<dt>' + esc(t('mk.lastUsed')) + '</dt><dd>' + fmtTime(mk.masterKey.lastUsedAt) + '</dd>' +
        '<dt>' + esc(t('mk.url')) + '</dt><dd>' + esc(mk.relayUrl || '\u2014') + '</dd></dl>' +
        '<div class="row" style="margin-top:14px"><button class="btn" id="rotmaster">' + esc(t('mk.rotate')) + '</button></div>';
    } else {
      out += '<div class="empty">' + esc(t('mk.none')) + '</div>' +
        '<div class="row" style="margin-top:14px"><button class="btn" id="newmaster">' + esc(t('mk.create')) + '</button></div>';
    }
    out += '</div>';
    return out;
  }

  /* ----------------------------- Scoreboard ----------------------------- */
  function viewScoreboard(d) {
    var rows = d.scoreboard || [];
    var out = '<h1>' + esc(t('sb.title')) + '</h1><p class="lede">' + esc(t('sb.lede')) + '</p>';
    out += '<div class="panel">';
    if (!rows.length) {
      out += '<div class="empty">' + esc(t('sb.empty')) + '</div>';
    } else {
      out += '<div class="tablewrap"><table><thead><tr><th>#</th><th>' + esc(t('sb.provider')) + '</th><th>' + esc(t('sb.cred')) + '</th>' +
        '<th>' + esc(t('sb.req')) + '</th><th>' + esc(t('sb.ok')) + '</th><th>' + esc(t('sb.err')) + '</th>' +
        '<th>' + esc(t('sb.tokens')) + '</th><th>' + esc(t('sb.avg')) + '</th><th>' + esc(t('sb.last')) + '</th></tr></thead><tbody>';
      rows.forEach(function (r, i) {
        out += '<tr><td class="mono">' + (i + 1) + '</td><td>' + esc(r.providerName) + '</td>' +
          '<td>' + esc(r.label) + ' <span class="mono muted">' + esc(r.keyHint || '') + '</span></td>' +
          '<td class="mono">' + fmtNum(r.requests) + '</td>' +
          '<td class="mono">' + fmtNum(r.success) + '</td>' +
          '<td class="mono">' + fmtNum(r.error) + '</td>' +
          '<td class="mono">' + fmtNum(r.totalTokens) + '</td>' +
          '<td class="mono">' + (r.avgLatencyMs != null ? r.avgLatencyMs + ' ms' : '\u2014') + '</td>' +
          '<td>' + fmtTime(r.lastUsedAt) + '</td></tr>';
      });
      out += '</tbody></table></div>';
    }
    out += '</div>';
    return out;
  }

  /* ------------------------------- Usage ------------------------------- */
  function viewUsage(d) {
    var events = (d.usage && d.usage.events) || [];
    var summary = (d.usage && d.usage.summary) || {};
    var diags = d.diagnostics || [];
    var out = '<h1>' + esc(t('us.title')) + '</h1><p class="lede">' + esc(t('us.lede')) + '</p>';
    out += '<div class="grid cards">' +
      card(t('ov.totalReq'), fmtNum(summary.total || 0)) +
      card(t('ov.success'), fmtNum(summary.success || 0)) +
      card(t('ov.errors'), fmtNum(summary.error || 0)) +
      card(t('ov.tokens'), fmtNum(summary.total_tokens || 0)) + '</div>';
    out += '<div class="panel"><div class="panel-head"><h2>' + esc(t('us.events')) + '</h2></div>';
    if (!events.length) {
      out += '<div class="empty">' + esc(t('us.empty')) + '</div>';
    } else {
      out += '<div class="tablewrap"><table><thead><tr><th>' + esc(t('us.time')) + '</th><th>' + esc(t('us.kind')) + '</th>' +
        '<th>' + esc(t('us.model')) + '</th><th>' + esc(t('us.status')) + '</th><th>' + esc(t('us.http')) + '</th>' +
        '<th>' + esc(t('us.latency')) + '</th><th>' + esc(t('us.errCode')) + '</th></tr></thead><tbody>';
      events.forEach(function (e) {
        out += '<tr><td class="mono">' + fmtTime(e.created_at) + '</td><td>' + esc(e.kind) + '</td>' +
          '<td class="mono">' + esc(e.model || '\u2014') + '</td><td>' + pill(e.status) + '</td>' +
          '<td class="mono">' + esc(e.http_status != null ? e.http_status : '\u2014') + '</td>' +
          '<td class="mono">' + (e.latency_ms != null ? e.latency_ms + ' ms' : '\u2014') + '</td>' +
          '<td class="mono">' + esc(e.error_code || '\u2014') + '</td></tr>';
      });
      out += '</tbody></table></div>';
    }
    out += '</div>';
    out += '<div class="panel"><div class="panel-head"><h2>' + esc(t('us.diag')) + '</h2></div>';
    if (!diags.length) {
      out += '<div class="empty">' + esc(t('us.diag.empty')) + '</div>';
    } else {
      out += '<div class="tablewrap"><table><thead><tr><th>' + esc(t('us.diag.time')) + '</th><th>' + esc(t('us.diag.kind')) + '</th><th>' + esc(t('us.diag.detail')) + '</th></tr></thead><tbody>';
      diags.forEach(function (g) {
        out += '<tr><td class="mono">' + fmtTime(g.createdAt) + '</td><td>' + esc(g.kind) + '</td><td class="mono">' + esc(JSON.stringify(g.detail)) + '</td></tr>';
      });
      out += '</tbody></table></div>';
    }
    out += '</div>';
    return out;
  }

  /* ------------------------------ Context ------------------------------ */
  function viewContext(d) {
    var cs = (d.settings && d.settings.settings) || d.context || {};
    return '<h1>' + esc(t('ctx.title')) + '</h1><p class="lede">' + esc(t('ctx.lede')) + '</p>' +
      '<div class="panel"><div id="ctxresult"></div><form id="ctxform" class="form-grid">' +
      '<label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="enabled" style="width:auto" ' + (cs.enabled ? 'checked' : '') + ' /> <span style="margin:0">' + esc(t('ctx.enabled')) + '</span></label>' +
      '<label class="field"><span>' + esc(t('ctx.mode')) + '</span><select name="mode">' +
        ['off','safe','smart'].map(function (m) { return '<option value="' + m + '" ' + (cs.mode === m ? 'selected' : '') + '>' + m + '</option>'; }).join('') +
      '</select></label>' +
      '<label class="field"><span>' + esc(t('ctx.minSavings')) + '</span><input type="number" step="0.01" min="0" max="1" name="minSavingsRatio" value="' + esc(cs.minSavingsRatio != null ? cs.minSavingsRatio : 0.05) + '" /></label>' +
      '<label class="field"><span>' + esc(t('ctx.maxHist')) + '</span><input type="number" min="2" max="5000" name="maxRetainedHistory" value="' + esc(cs.maxRetainedHistory != null ? cs.maxRetainedHistory : 200) + '" /></label>' +
      '<label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="semanticSummarization" style="width:auto" ' + (cs.semanticSummarization ? 'checked' : '') + ' /> <span style="margin:0">' + esc(t('ctx.sematic')) + '</span></label>' +
      '<label class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="safeFallback" style="width:auto" ' + (cs.safeFallback ? 'checked' : '') + ' /> <span style="margin:0">' + esc(t('ctx.safeFallback')) + '</span></label>' +
      '<div class="row full"><button class="btn" type="submit">' + esc(t('ctx.save')) + '</button></div>' +
      '</form></div>';
  }

  /* ------------------------------ Settings ------------------------------ */
  function viewSettings(d) {
    var lang = state.lang;
    return '<h1>' + esc(t('st.title')) + '</h1><p class="lede">' + esc(t('st.lede')) + '</p>' +
      '<div class="panel"><div class="panel-head"><h2>' + esc(t('st.language')) + '</h2></div>' +
      '<label class="field" style="max-width:280px"><span>' + esc(t('st.language')) + '</span>' +
      '<select id="langselect"><option value="en" ' + (lang === 'en' ? 'selected' : '') + '>English</option>' +
      '<option value="vi" ' + (lang === 'vi' ? 'selected' : '') + '>Ti\u1EBFng Vi\u1EC7t</option></select></label></div>' +
      '<div class="panel"><div class="panel-head"><h2>' + esc(t('st.pw.title')) + '</h2></div>' +
      '<div id="pwresult"></div><form id="pwform" class="form-grid">' +
      '<label class="field"><span>' + esc(t('st.pw.current')) + '</span><input type="password" name="currentPassword" autocomplete="current-password" required /></label>' +
      '<label class="field"><span>' + esc(t('st.pw.new')) + '</span><input type="password" name="newPassword" autocomplete="new-password" required minlength="12" /></label>' +
      '<div class="row full"><button class="btn" type="submit">' + esc(t('st.pw.save')) + '</button></div>' +
      '</form></div>';
  }

  /* ------------------------------- Routing ------------------------------- */
  async function route() {
    var tabs = TABS;
    if (tabs.indexOf(state.tab) === -1) state.tab = 'overview';
    shell('<p class="lede">' + esc(t('loading')) + '</p>');
    var d = {};
    try {
      if (state.tab === 'overview') d = await api('/api/admin/overview');
      else if (state.tab === 'charts') d = await api('/api/admin/charts?buckets=24&bucketMinutes=60');
      else if (state.tab === 'providers') d = await api('/api/admin/providers');
      else if (state.tab === 'master') d = await api('/api/admin/master-key');
      else if (state.tab === 'scoreboard') d = await api('/api/admin/scoreboard');
      else if (state.tab === 'usage') {
        var u = await api('/api/admin/usage?limit=100');
        var g = await api('/api/admin/diagnostics?limit=50');
        d = { usage: u, diagnostics: g.events };
      }
      else if (state.tab === 'context') d = await api('/api/admin/settings');
      else if (state.tab === 'settings') d = {};
    } catch (e) {
      if (String(e.message).indexOf('401') >= 0 || /unauthor|session/i.test(e.message)) {
        state.authed = false; state.csrf = '';
        return renderLogin(false, msg('err', e.message));
      }
      shell(msg('err', e.message));
      return;
    }
    state.data[state.tab] = d;
    var html;
    if (state.tab === 'overview') html = viewOverview(d);
    else if (state.tab === 'charts') html = viewCharts(d);
    else if (state.tab === 'providers') html = viewProviders(d);
    else if (state.tab === 'master') html = viewMaster(d);
    else if (state.tab === 'scoreboard') html = viewScoreboard(d);
    else if (state.tab === 'usage') html = viewUsage(d);
    else if (state.tab === 'context') html = viewContext(d);
    else html = viewSettings(d);
    shell(html);
    bind();
  }

  function bind() {
    var ap = document.getElementById('addprov');
    if (ap) ap.addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(ap);
      var btn = ap.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api('/api/admin/providers', { method: 'POST', body: {
          name: fd.get('name'), baseUrl: fd.get('baseUrl'),
          apiKey: fd.get('apiKey') || undefined,
          models: String(fd.get('models') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
          attachedPrompt: fd.get('attachedPrompt') || undefined,
          allowPrivateNetwork: !!fd.get('allowPrivateNetwork'),
        } });
        route();
      } catch (err) {
        btn.disabled = false;
        document.getElementById('addprovresult').innerHTML = msg('err', err.message);
      }
    });

    root.querySelectorAll('form[data-addcred]').forEach(function (f) {
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var fd = new FormData(f);
        var pid = f.getAttribute('data-addcred');
        try { await api('/api/admin/providers/' + pid + '/credentials', { method: 'POST', body: { label: fd.get('label') || 'primary', apiKey: fd.get('apiKey') } }); route(); }
        catch (err) { alert(err.message); }
      });
    });

    root.querySelectorAll('button[data-delprov]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm(t('pv.delete.confirm'))) return;
        try { await api('/api/admin/providers/' + b.getAttribute('data-delprov'), { method: 'DELETE' }); route(); }
        catch (err) { alert(err.message); }
      });
    });
    root.querySelectorAll('button[data-delcred]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var pid = b.getAttribute('data-prov');
        try { await api('/api/admin/providers/' + pid + '/credentials/' + b.getAttribute('data-delcred'), { method: 'DELETE' }); route(); }
        catch (err) { alert(err.message); }
      });
    });

    // Attached prompt inline editor
    root.querySelectorAll('button[data-editprompt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var pid = b.getAttribute('data-editprompt');
        var form = root.querySelector('form[data-promptform="' + pid + '"]');
        if (form) form.classList.toggle('hidden');
      });
    });
    root.querySelectorAll('button[data-cancelprompt]').forEach(function (b) {
      b.addEventListener('click', function () {
        var form = root.querySelector('form[data-promptform="' + b.getAttribute('data-cancelprompt') + '"]');
        if (form) form.classList.add('hidden');
      });
    });
    root.querySelectorAll('form[data-promptform]').forEach(function (f) {
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var pid = f.getAttribute('data-promptform');
        var fd = new FormData(f);
        try {
          await api('/api/admin/providers/' + pid, { method: 'PATCH', body: { attachedPrompt: fd.get('attachedPrompt') || '' } });
          route();
        } catch (err) {
          var r = root.querySelector('div[data-promptresult="' + pid + '"]');
          if (r) r.innerHTML = msg('err', err.message);
        }
      });
    });

    // Test request: toggle inline form, then run
    root.querySelectorAll('button[data-test]').forEach(function (b) {
      b.addEventListener('click', function () {
        var form = root.querySelector('form[data-testform="' + b.getAttribute('data-test') + '"]');
        if (form) form.classList.toggle('hidden');
      });
    });
    root.querySelectorAll('form[data-testform]').forEach(function (f) {
      f.addEventListener('submit', async function (e) {
        e.preventDefault();
        var pid = f.getAttribute('data-testform');
        var fd = new FormData(f);
        var box = root.querySelector('div[data-testresult="' + pid + '"]');
        var btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        if (box) box.innerHTML = '<span class="spinner"></span>';
        try {
          var r = await api('/api/admin/providers/' + pid + '/test', { method: 'POST', body: { model: fd.get('model'), prompt: fd.get('prompt') } });
          if (box) {
            var usage = r.usage ? ('prompt ' + (r.usage.promptTokens == null ? '\u2014' : r.usage.promptTokens) + ' / completion ' + (r.usage.completionTokens == null ? '\u2014' : r.usage.completionTokens) + ' / total ' + (r.usage.totalTokens == null ? '\u2014' : r.usage.totalTokens) + ' (' + esc(r.usage.source || '') + ')') : '\u2014';
            box.innerHTML = '<div class="panel" style="margin-top:10px"><h2>' + esc(t('pv.test.result')) + '</h2>' +
              (r.success ? msg('ok', 'HTTP ' + r.httpStatus + ' / ' + r.latencyMs + ' ms / ' + JSON.stringify(r.outputText)) : msg('err', (r.error ? r.error.code : 'ERROR') + ': ' + (r.error ? r.error.message : ''))) +
              '<dl class="kv"><dt>' + esc(t('test.usage')) + '</dt><dd>' + usage + '</dd>' +
              '<dt>' + esc(t('test.reqId')) + '</dt><dd>' + esc(r.requestId || '\u2014') + '</dd></dl></div>';
          }
        } catch (err) {
          if (box) box.innerHTML = msg('err', err.message);
        }
        btn.disabled = false;
      });
    });

    // Master key
    var nm = document.getElementById('newmaster');
    if (nm) nm.addEventListener('click', async function () {
      try { var r = await api('/api/admin/master-key', { method: 'POST', body: {} }); state.masterKeyShown = { rawKey: r.masterKey.rawKey, relayUrl: r.masterKey.relayUrl, prefix: r.masterKey.prefix }; route(); }
      catch (err) { document.getElementById('masterresult').innerHTML = msg('err', err.message); }
    });
    var rm = document.getElementById('rotmaster');
    if (rm) rm.addEventListener('click', async function () {
      try { var r = await api('/api/admin/master-key/rotate', { method: 'POST', body: {} }); state.masterKeyShown = { rawKey: r.masterKey.rawKey, relayUrl: r.masterKey.relayUrl, prefix: r.masterKey.prefix }; route(); }
      catch (err) { document.getElementById('masterresult').innerHTML = msg('err', err.message); }
    });

    // Context form
    var cf = document.getElementById('ctxform');
    if (cf) cf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(cf);
      try {
        await api('/api/admin/settings', { method: 'PATCH', body: { context: {
          enabled: !!fd.get('enabled'), mode: fd.get('mode'),
          minSavingsRatio: Number(fd.get('minSavingsRatio')),
          maxRetainedHistory: Number(fd.get('maxRetainedHistory')),
          semanticSummarization: !!fd.get('semanticSummarization'),
          safeFallback: !!fd.get('safeFallback'),
        } } });
        document.getElementById('ctxresult').innerHTML = msg('ok', t('ctx.saved'));
      } catch (err) { document.getElementById('ctxresult').innerHTML = msg('err', err.message); }
    });

    // Settings: language + password
    var ls = document.getElementById('langselect');
    if (ls) ls.addEventListener('change', async function () {
      state.lang = ls.value; saveLang(ls.value);
      try { await api('/api/admin/settings', { method: 'PATCH', body: { ui: { language: ls.value } } }); } catch (e) {}
      route();
    });
    var pf = document.getElementById('pwform');
    if (pf) pf.addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(pf);
      try { await api('/api/auth/password', { method: 'POST', body: { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') } }); document.getElementById('pwresult').innerHTML = msg('ok', t('st.pw.saved')); pf.reset(); }
      catch (err) { document.getElementById('pwresult').innerHTML = msg('err', err.message); }
    });
  }

  async function boot() {
    var st;
    try { st = await api('/api/auth/status'); }
    catch (e) { renderLogin(false, msg('err', t('login.offline'))); return; }
    state.setupRequired = !!(st && st.setupRequired);
    if (!state.authed) return renderLogin(state.setupRequired);
    // Sync language from the server setting once, after auth.
    try {
      var s = await api('/api/admin/settings');
      if (s && s.ui && s.ui.language && (s.ui.language === 'en' || s.ui.language === 'vi')) {
        state.lang = s.ui.language; saveLang(s.ui.language);
      }
      if (s && s.context) state.data.contextSettings = s;
    } catch (e) {}
    route();
  }

  boot();
})();
