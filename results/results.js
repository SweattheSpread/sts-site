(() => {
  const MARKETS = [
    ['', 'All'],
    ['spread', 'Spread'],
    ['total', 'Total'],
    ['ml', 'Moneyline'],
    ['team_total', 'Team Total'],
    ['player_prop', 'Player Prop'],
    ['parlay', 'Parlay'],
    ['rr', 'Round Robin'],
    ['teaser', 'Teaser'],
    ['other', 'Other']
  ];
  const RESULTS = [
    ['', 'All'],
    ['W', 'Won'],
    ['L', 'Lost'],
    ['P', 'Push'],
    ['pending', 'Pending'],
    ['V', 'Void']
  ];
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const odds = o => o == null ? '—' : (o > 0 ? '+' : '') + o;
  const uu = u => u == null || Number.isNaN(u) ? '—' : Number(u).toFixed(2) + 'u';
  const sg = u => u == null || Number.isNaN(u) ? '—' : (u > 0 ? '+' : u < 0 ? '−' : '') + Math.abs(u).toFixed(2) + 'u';
  const fmtDay = s => {
    if (!s) return '—';
    return new Date(s + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const todayPT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const addDays = (ymd, n) => {
    const d = new Date(ymd + 'T12:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const monthStartPT = () => {
    const [y, m] = todayPT().split('-');
    return `${y}-${m}-01`;
  };

  const state = { sport: '', market: '', result: '', from: '', to: '', preset: 'all', props: false, sort: 'day', dir: -1, page: 1, size: 25 };
  let plays = [], record = null, updated = '';

  function paramsFromURL() {
    const q = new URLSearchParams(location.search);
    if (q.has('sport')) state.sport = q.get('sport') || '';
    if (q.has('market')) state.market = q.get('market') || '';
    if (q.has('result')) state.result = q.get('result') || '';
    if (q.has('from')) state.from = q.get('from') || '';
    if (q.has('to')) state.to = q.get('to') || '';
    if (q.get('props') === '1') { state.props = true; state.market = 'player_prop'; }
    if (q.get('sort')) state.sort = q.get('sort');
    if (q.get('dir') === 'asc') state.dir = 1;
    if (q.get('dir') === 'desc') state.dir = -1;
    const pg = parseInt(q.get('page') || '1', 10); if (pg > 0) state.page = pg;
    const sz = parseInt(q.get('size') || '25', 10); if ([25, 50, 100].includes(sz)) state.size = sz;
    if (state.from || state.to) state.preset = 'custom';
  }
  function writeURL() {
    const q = new URLSearchParams();
    if (state.sport) q.set('sport', state.sport);
    if (state.market) q.set('market', state.market);
    if (state.result) q.set('result', state.result);
    if (state.from) q.set('from', state.from);
    if (state.to) q.set('to', state.to);
    if (state.props) q.set('props', '1');
    if (state.sort !== 'day' || state.dir !== -1) { q.set('sort', state.sort); q.set('dir', state.dir === 1 ? 'asc' : 'desc'); }
    if (state.page !== 1) q.set('page', String(state.page));
    if (state.size !== 25) q.set('size', String(state.size));
    const qs = q.toString();
    history.replaceState(null, '', qs ? '?' + qs : location.pathname);
  }

  function filtered() {
    return plays.filter(p => {
      if (state.sport && p.league !== state.sport) return false;
      if (state.market) {
        if (state.market === 'other') {
          if (p.market !== 'other') return false;
        } else if (p.market !== state.market) return false;
      }
      if (state.result === 'pending') { if (!p.pending) return false; }
      else if (state.result && p.result !== state.result) return false;
      const day = p.day || p.date || '';
      if (state.from && day < state.from) return false;
      if (state.to && day > state.to) return false;
      return true;
    });
  }

  function statsOf(rows) {
    const g = rows.filter(p => p.result === 'W' || p.result === 'L' || p.result === 'P');
    const w = g.filter(p => p.result === 'W').length;
    const l = g.filter(p => p.result === 'L').length;
    const p = g.filter(p => p.result === 'P').length;
    const units = g.reduce((s, x) => s + (x.pl || 0), 0);
    const risked = g.reduce((s, x) => s + (x.units || 0), 0);
    return { w, l, p, n: g.length, units, risked, roi: risked ? (100 * units / risked) : null, pending: rows.filter(x => x.pending).length, voided: rows.filter(x => x.result === 'V').length, shown: rows.length };
  }

  function playText(p) {
    if (p.matchup && p.pick) return `${p.matchup}: ${p.pick}`;
    return p.pick || p.matchup || '—';
  }
  function resultLabel(p) {
    if (p.pending) return 'Pending';
    return { W: 'Won', L: 'Lost', P: 'Push', V: 'Void' }[p.result] || '—';
  }
  function resultClass(p) {
    if (p.pending) return 'pend';
    if (p.result === 'W' || (p.pl != null && p.pl > 0)) return 'win';
    if (p.result === 'L' || (p.pl != null && p.pl < 0)) return 'loss';
    if (p.result === 'V') return 'void';
    return '';
  }

  function cmp(a, b, key) {
    if (key === 'play') {
      const av = playText(a).toLowerCase(), bv = playText(b).toLowerCase();
      return av < bv ? -1 : av > bv ? 1 : 0;
    }
    let av = a[key], bv = b[key];
    if (key === 'result') { av = a.pending ? 'pending' : a.result; bv = b.pending ? 'pending' : b.result; }
    if (av == null && bv == null) return 0;
    if (av == null) return -1;
    if (bv == null) return 1;
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return av < bv ? -1 : av > bv ? 1 : 0;
  }
  function sorted(rows) {
    const k = state.sort, dir = state.dir;
    return rows.slice().sort((a, b) => {
      let c = cmp(a, b, k);
      if (c === 0 && k !== 'day') c = cmp(a, b, 'day');
      if (c === 0) c = (a.n || 0) - (b.n || 0);
      return c * dir;
    });
  }

  function paintStats(s) {
    const $ = id => document.getElementById(id);
    $('rs-wl').textContent = `${s.w}–${s.l}–${s.p}`;
    $('rs-n').textContent = `${s.n} graded official bet${s.n === 1 ? '' : 's'}`;
    $('rs-u').textContent = sg(s.units);
    $('rs-u').classList.toggle('lime', s.units >= 0);
    $('rs-u').classList.toggle('loss', s.units < 0);
    $('rs-risk').textContent = `${s.risked.toFixed(2)}u risked`;
    $('rs-roi').textContent = s.roi == null ? '—' : (s.roi > 0 ? '+' : '') + s.roi.toFixed(2) + '%';
    const bits = [];
    if (record) bits.push(`Launch record ${record.w}–${record.l}–${record.p}, ${sg(record.units)} on ${record.risked.toFixed(2)}u.`);
    if (s.pending) bits.push(`${s.pending} pending, not in the totals.`);
    if (s.voided) bits.push(`${s.voided} void, not in the totals.`);
    bits.push('Past bets are a report, not a forecast.');
    if (updated) bits.push(`Updated ${updated}.`);
    $('rs-fine').textContent = bits.join(' ');
  }

  function paintChart(rows) {
    const canvas = document.getElementById('eq-chart');
    const empty = document.getElementById('eq-empty');
    const tip = document.getElementById('eq-tip');
    const g = rows.filter(p => p.result === 'W' || p.result === 'L' || p.result === 'P')
      .slice().sort((a, b) => (a.day || a.date || '').localeCompare(b.day || b.date || '') || (a.n || 0) - (b.n || 0));
    const daily = [];
    let cum = 0;
    const map = new Map();
    g.forEach(p => {
      const day = p.day || p.date;
      cum += p.pl || 0;
      const rec = map.get(day) || { day, u: 0, n: 0, cum: 0 };
      rec.u += p.pl || 0; rec.n += 1; rec.cum = cum;
      map.set(day, rec);
    });
    map.forEach(v => daily.push({ ...v, u: Math.round(v.u * 100) / 100, cum: Math.round(v.cum * 100) / 100 }));
    if (!daily.length) {
      canvas.hidden = true; empty.hidden = false; tip.hidden = true;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    canvas.hidden = false; empty.hidden = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 640, h = canvas.clientHeight || 240;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pad = { t: 16, r: 20, b: 28, l: 52 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const cums = daily.map(d => d.cum);
    let lo = Math.min(0, ...cums), hi = Math.max(0, ...cums);
    if (lo === hi) { hi += 1; lo -= 1; }
    const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
    const xAt = i => pad.l + (daily.length === 1 ? iw / 2 : iw * i / (daily.length - 1));
    const yAt = v => pad.t + ih * (1 - (v - lo) / (hi - lo));
    ctx.strokeStyle = '#1d2127'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, pad.t + ih); ctx.lineTo(pad.l + iw, pad.t + ih); ctx.stroke();
    const zero = yAt(0);
    ctx.strokeStyle = '#ffffff22'; ctx.beginPath(); ctx.moveTo(pad.l, zero); ctx.lineTo(pad.l + iw, zero); ctx.stroke();
    ctx.fillStyle = '#8b939c'; ctx.font = '11px system-ui,sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = lo + (hi - lo) * (i / ticks);
      const y = yAt(v);
      ctx.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + 'u', pad.l - 8, y);
    }
    ctx.textBaseline = 'top';
    const labelAt = [0, Math.floor((daily.length - 1) / 2), daily.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    labelAt.forEach(i => {
      ctx.textAlign = i === 0 ? 'left' : i === daily.length - 1 ? 'right' : 'center';
      ctx.fillText(fmtDay(daily[i].day), xAt(i), pad.t + ih + 8);
    });
    ctx.beginPath();
    daily.forEach((d, i) => { const x = xAt(i), y = yAt(d.cum); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo(xAt(daily.length - 1), zero); ctx.lineTo(xAt(0), zero); ctx.closePath();
    const last = daily[daily.length - 1].cum;
    ctx.fillStyle = last >= 0 ? 'rgba(198,255,0,.12)' : 'rgba(255,77,94,.12)';
    ctx.fill();
    ctx.beginPath();
    daily.forEach((d, i) => { const x = xAt(i), y = yAt(d.cum); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = last >= 0 ? '#C6FF00' : '#ff4d5e'; ctx.lineWidth = 2; ctx.stroke();
    canvas.onmousemove = ev => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      let best = 0, bd = 1e9;
      daily.forEach((d, i) => { const dx = Math.abs(xAt(i) - x); if (dx < bd) { bd = dx; best = i; } });
      const d = daily[best];
      tip.hidden = false;
      tip.textContent = `${fmtDay(d.day)} · day ${sg(d.u)} on ${d.n} play${d.n === 1 ? '' : 's'} · cum ${sg(d.cum)}`;
    };
    canvas.onmouseleave = () => { tip.hidden = true; };
  }

  function paintTable(rows) {
    const body = document.getElementById('rs-body');
    const count = document.getElementById('rs-count');
    const pages = Math.max(1, Math.ceil(rows.length / state.size));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.size;
    const slice = rows.slice(start, start + state.size);
    count.textContent = rows.length ? `Showing ${start + 1}–${start + slice.length} of ${rows.length} plays` : 'No plays match these filters.';
    body.innerHTML = slice.map(p => {
      const rc = resultClass(p);
      const play = playText(p);
      return `<tr class="${rc}">
        <td data-th="Date">${esc(fmtDay(p.day || p.date))}</td>
        <td data-th="#">${p.n != null ? '#' + p.n : '—'}</td>
        <td data-th="Sport">${esc(p.league || '—')}</td>
        <td data-th="Play" class="play">${esc(play)}</td>
        <td data-th="Market">${esc(p.market_label || '—')}</td>
        <td data-th="Odds">${esc(odds(p.odds))}</td>
        <td data-th="Units">${esc(uu(p.units))}</td>
        <td data-th="Result" class="u ${rc}">${esc(resultLabel(p))}</td>
        <td data-th="P/L" class="u ${rc}">${p.pending || p.pl == null ? '—' : esc(sg(p.pl))}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="9" class="empty">No plays match these filters.</td></tr>`;
    document.querySelectorAll('.rs-table thead th').forEach(th => {
      const k = th.dataset.sort;
      th.setAttribute('aria-sort', k === state.sort ? (state.dir === 1 ? 'ascending' : 'descending') : 'none');
    });
    const pager = document.getElementById('rs-pager');
    if (pages <= 1) { pager.innerHTML = ''; return; }
    const btn = (p, label, disabled) => `<button type="button" ${disabled ? 'disabled' : ''} data-page="${p}">${label}</button>`;
    let html = btn(state.page - 1, 'Prev', state.page <= 1);
    const windowed = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - state.page) <= 2) windowed.push(i);
      else if (windowed[windowed.length - 1] !== '…') windowed.push('…');
    }
    windowed.forEach(i => {
      if (i === '…') html += '<span class="gap">…</span>';
      else html += `<button type="button" data-page="${i}" class="${i === state.page ? 'on' : ''}">${i}</button>`;
    });
    html += btn(state.page + 1, 'Next', state.page >= pages);
    pager.innerHTML = html;
  }

  function render() {
    const rows = sorted(filtered());
    paintStats(statsOf(rows));
    paintChart(rows);
    paintTable(rows);
    writeURL();
    syncForm();
  }

  function syncForm() {
    document.getElementById('f-sport').value = state.sport;
    document.getElementById('f-from').value = state.from;
    document.getElementById('f-to').value = state.to;
    document.getElementById('f-props').checked = state.props || state.market === 'player_prop';
    document.getElementById('f-page-size').value = String(state.size);
    document.querySelectorAll('#f-market button').forEach(b => b.classList.toggle('on', (b.dataset.val || '') === state.market));
    document.querySelectorAll('#f-result button').forEach(b => b.classList.toggle('on', (b.dataset.val || '') === state.result));
    document.querySelectorAll('.rs-presets button').forEach(b => b.classList.toggle('on', b.dataset.preset === state.preset));
  }

  function chips(el, items) {
    el.innerHTML = el.querySelector('legend').outerHTML + items.map(([v, lab]) =>
      `<button type="button" data-val="${esc(v)}" class="${v === '' ? 'on' : ''}">${esc(lab)}</button>`).join('');
  }

  function bind() {
    chips(document.getElementById('f-market'), MARKETS);
    chips(document.getElementById('f-result'), RESULTS);
    const sports = [...new Set(plays.map(p => p.league).filter(Boolean))].sort();
    const sel = document.getElementById('f-sport');
    sports.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
    sel.addEventListener('change', () => { state.sport = sel.value; state.page = 1; render(); });
    document.getElementById('f-from').addEventListener('change', e => { state.from = e.target.value; state.preset = 'custom'; state.page = 1; render(); });
    document.getElementById('f-to').addEventListener('change', e => { state.to = e.target.value; state.preset = 'custom'; state.page = 1; render(); });
    document.getElementById('f-props').addEventListener('change', e => {
      state.props = e.target.checked;
      state.market = state.props ? 'player_prop' : (state.market === 'player_prop' ? '' : state.market);
      state.page = 1; render();
    });
    document.getElementById('f-page-size').addEventListener('change', e => { state.size = parseInt(e.target.value, 10); state.page = 1; render(); });
    document.getElementById('f-market').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.market = b.dataset.val || '';
      state.props = state.market === 'player_prop';
      state.page = 1; render();
    });
    document.getElementById('f-result').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      state.result = b.dataset.val || '';
      state.page = 1; render();
    });
    document.querySelector('.rs-presets').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const p = b.dataset.preset, t = todayPT();
      state.preset = p;
      if (p === '7') { state.from = addDays(t, -6); state.to = t; }
      else if (p === '30') { state.from = addDays(t, -29); state.to = t; }
      else if (p === 'month') { state.from = monthStartPT(); state.to = t; }
      else { state.from = ''; state.to = ''; }
      state.page = 1; render();
    });
    document.querySelectorAll('.rs-table thead th[data-sort] button').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.parentElement.dataset.sort;
        if (state.sort === k) state.dir *= -1;
        else { state.sort = k; state.dir = k === 'day' || k === 'n' || k === 'pl' ? -1 : 1; }
        render();
      });
    });
    document.getElementById('rs-pager').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      state.page = parseInt(b.dataset.page, 10); render();
    });
    let resizeTO;
    addEventListener('resize', () => { clearTimeout(resizeTO); resizeTO = setTimeout(() => paintChart(sorted(filtered())), 120); });
  }

  async function boot() {
    paramsFromURL();
    try {
      const d = await (await fetch('/results.json', { cache: 'no-cache' })).json();
      plays = d.plays || [];
      record = d.record || null;
      updated = d.updated || '';
      bind();
      render();
    } catch (e) {
      console.warn('results.json not loaded', e);
      document.getElementById('rs-fine').textContent = 'Could not load the all-time results.';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
