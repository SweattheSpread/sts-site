/* STS live score popover + likely-to-hit meter .
   Data: ESPN public site API (site.api.espn.com), called from the browser (CORS: Access-Control-Allow-Origin: *).
   Each pending card in data.json may carry c.espn = {sport, legs:[{path,event,comp?,date,kind,side,line,ou,player,stat}]} added at build time.

   METER THRESHOLDS (simple and explainable; labels are On pace / Close / Off pace, never certainty words):
   - frac = share of regulation elapsed (period + clock). rem = 1 - frac.
   - ML / spread (team sports): adj margin m = our score - their score (+ spread line). Scale s = SD[sport] * sqrt(rem)
       (SD = rough full-game margin swing: NBA 12, NCAAB 11, NFL/NCAAF 13, NHL 2, MLB 3.5). z = m / s.
       z >= 0.5 -> On pace, z <= -0.5 -> Off pace, else Close. Before 5% elapsed -> Close.
   - Game / team totals: pace = current points / frac. Over: diff = pace - line (Under: line - pace).
       diff >= 4% of line -> On pace, diff <= -4% -> Off pace, else Close. Already over the line: Over On pace, Under Off pace. Before 15% elapsed -> Close.
   - Player props (ESPN box score): Over already cleared -> On pace. Else pace = stat / frac;
       pace >= 1.15 x line -> On pace; pace < 0.85 x line and frac >= 0.5 -> Off pace; else Close.
       Under: stat over the line -> Off pace; pace <= 0.85 x line or (frac >= 0.75 and 1+ under) -> On pace; pace > 1.15 x line -> Off pace; else Close.
   - Tennis ML (best of 3): up a set -> On pace (Close if down 2+ games in the current set); sets level -> games lead 2+ On pace, trail 2+ Off pace, else Close;
       down a set -> Off pace (Close if up 2+ games in the current set).
   - Parlay / SGP: each leg is graded on its own market. The ticket is Lost as soon as any leg loses;
       Won only when every non-push leg has won and is final; a push is dropped. Otherwise Pending.
       Unmatched legs stay unverified and are not guessed. Round robins show per-leg status only.
   - Final: green/red by the final result; shown as Won / Lost / Push. Singles never use parlay leg UI. */
(() => {
  const MOCK = false;
  const API = 'https://site.api.espn.com/apis/site/v2/sports/';
  const SD = { NBA: 12, WNBA: 10, NCAAB: 11, NFL: 13, NCAAF: 13, NHL: 2, MLB: 3.5 };
  const PER = { NBA: [4, 12], WNBA: [4, 10], NCAAB: [2, 20], NFL: [4, 15], NCAAF: [4, 15], NHL: [3, 20], MLB: [9, 0] };
  const STAT = { points: ['PTS'], pts: ['PTS'], rebounds: ['REB'], assists: ['AST'], threes: ['3PT'], 'shots on goal': ['SOG'], sog: ['SOG'], goals: ['G'], hits: ['H'], strikeouts: ['K'] };
  const NHLPTS = ['G', 'A'];
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => (s || '').toLowerCase().replace(/[^a-z ]/g, '');
  const same = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a === b || b.includes(a) || a.includes(b) || a.split(' ').pop() === b.split(' ').pop()); };
  const pt = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' PT';

  function ticketOf(c) {
    return c.ticket || c.espn?.ticket || (c.rr ? 'round_robin' : (/parlay/i.test(c.type || '') ? 'parlay' : /sgp/i.test(c.type || '') ? 'sgp' : 'single'));
  }
  function isMulti(c) {
    const t = ticketOf(c);
    return t === 'parlay' || t === 'sgp' || t === 'round_robin';
  }

  /* ---------- fetch with short cache (one request per board per 20s, shared by all cards) ---------- */
  const cache = new Map();
  async function get(url) {
    const h = cache.get(url); if (h && Date.now() - h.t < 20000) return h.p;
    const p = fetch(url).then(r => { if (!r.ok) throw r.status; return r.json(); }); cache.set(url, { t: Date.now(), p });
    p.catch(() => cache.delete(url)); return p;
  }
  /* ---------- normalize one leg into {state, detail, frac, teams[], sets?, stat?} ---------- */
  function clockFrac(sport, period, clock, state) {
    if (state === 'post') return 1; const pc = PER[sport]; if (!pc || !period) return 0;
    const [n, len] = pc; if (sport === 'MLB') return Math.min(1, (period - 1) / n + 0.05);
    const [m, s] = String(clock || '0:0').split(':').map(Number); const left = (m || 0) + (s || 0) / 60;
    return Math.min(1, ((Math.min(period, n) - 1) * len + (len - left)) / (n * len));
  }
  async function legState(sport, leg) {
    if (leg.unverified || !leg.path || !(leg.event || leg.comp)) {
      return { state: 'unverified', detail: 'Score unverified' };
    }
    if (leg.path.startsWith('tennis')) {
      const b = await get(`${API}${leg.path}/scoreboard?dates=${leg.date}`);
      for (const e of b.events || []) for (const g of e.groupings || []) for (const c of g.competitions) if (c.id === leg.comp) {
        const st = c.status.type, pl = c.competitors.map(x => ({ name: x.athlete?.displayName || '?', winner: x.winner, sets: (x.linescores || []).map(l => l.value) }));
        return { state: st.state, detail: st.detail || st.shortDetail, start: c.date, tennis: pl };
      }
      throw 'nomatch';
    }
    const b = await get(`${API}${leg.path}/scoreboard?dates=${leg.date}`);
    const e = (b.events || []).find(x => x.id === leg.event); if (!e) throw 'nomatch';
    const c = e.competitions[0], st = c.status;
    const teams = c.competitors.map(x => ({ name: x.team.displayName, short: x.team.shortDisplayName, abbr: x.team.abbreviation, score: +x.score || 0, ha: x.homeAway, winner: x.winner }))
      .sort((a, b) => (a.ha === 'away' ? -1 : 1));
    const out = { state: st.type.state, detail: st.type.shortDetail, start: e.date, period: st.period, clock: st.displayClock, frac: clockFrac(sport, st.period, st.displayClock, st.type.state), teams };
    if (leg.kind === 'prop' && out.state !== 'pre') {
      const s = await get(`${API}${leg.path}/summary?event=${leg.event}`); out.stat = null;
      const keys = sport === 'NHL' && /point/.test(leg.stat) ? NHLPTS : (STAT[leg.stat] || [leg.stat.toUpperCase()]);
      for (const tm of s.boxscore?.players || []) for (const grp of tm.statistics || []) for (const a of grp.athletes || []) if (same(leg.player, a.athlete.displayName)) {
        let v = 0, hit = false; keys.forEach(k => { const i = (grp.labels || []).indexOf(k); if (i >= 0) { hit = true; v += parseFloat(String(a.stats[i]).split('-')[0]) || 0; } });
        if (hit) out.stat = { v, name: a.athlete.displayName };
      }
    }
    return out;
  }
  /* ---------- review states (disabled) ---------- */
  function mockState(sport, leg, i) {
    if (leg.path.startsWith('tennis')) return { state: 'in', detail: '3rd Set', tennis: [{ name: leg.side || 'Player A', sets: [6, 4, 3 + i % 2] }, { name: 'Opponent', sets: [3, 6, 2] }] };
    const f = [0.35, 0.6, 0.8][i % 3], P = PER[sport] || [3, 20], period = Math.min(P[0], 1 + Math.floor(f * P[0]));
    const teams = [{ name: 'Away Team', abbr: 'AWY', score: sport === 'NHL' ? 2 : 48, ha: 'away' }, { name: 'Home Team', abbr: 'HME', score: sport === 'NHL' ? 1 : 51, ha: 'home' }];
    if (leg.side) teams[0].name = leg.side;
    return { state: 'in', detail: `${['1st', '2nd', '3rd', '4th'][period - 1]} · 8:42`, period, clock: '8:42', frac: f, teams, stat: leg.kind === 'prop' ? { v: i % 2 ? 0 : Math.ceil(leg.line), name: leg.player } : null };
  }
  /* ---------- meter ---------- */
  const lvl = (z, hi = 0.5) => (z >= hi ? 'g' : z <= -hi ? 'r' : 'y');
  function meter(sport, leg, s) {
    if (s.state === 'unverified') return { c: 'y', why: 'Not matched to a score — left unverified', unverified: 1 };
    if (s.state === 'pre') return null;
    if (s.tennis) {
      const me = s.tennis.findIndex(p => same(leg.side, p.name)), [A, B] = me === 1 ? [s.tennis[1], s.tennis[0]] : s.tennis;
      if (s.state === 'post') {
        if (leg.kind === 'spread' && leg.line != null) {
          const unit = String(leg.unit || '').replace(/s$/, '');
          const useSets = unit === 'set' || (!unit && Math.abs(leg.line) <= 2.5);
          if (useSets) {
            let sw = 0, sl = 0; const n = Math.min(A.sets.length, B.sets.length);
            for (let k = 0; k < n; k++) if (A.sets[k] !== B.sets[k]) A.sets[k] > B.sets[k] ? sw++ : sl++;
            const m = sw - sl + leg.line;
            return { c: m > 0 ? 'g' : m < 0 ? 'r' : 'y', why: `Sets ${sw}-${sl} vs ${leg.line > 0 ? '+' : ''}${leg.line} sets`, fin: 1 };
          }
          const ag = A.sets.reduce((t, v) => t + (v || 0), 0), bg = B.sets.reduce((t, v) => t + (v || 0), 0);
          const m = ag - bg + leg.line;
          return { c: m > 0 ? 'g' : m < 0 ? 'r' : 'y', why: `Games ${ag}-${bg} (margin ${ag - bg > 0 ? '+' : ''}${ag - bg}) vs ${leg.line > 0 ? '+' : ''}${leg.line}`, fin: 1 };
        }
        return { c: A.winner ? 'g' : 'r', why: A.winner ? 'Won the match' : 'Lost the match', fin: 1 };
      }
      let sw = 0, sl = 0; const n = A.sets.length;
      for (let k = 0; k < n - 1; k++) A.sets[k] > B.sets[k] ? sw++ : sl++;
      const g = (A.sets[n - 1] || 0) - (B.sets[n - 1] || 0), sets = `Sets ${sw}-${sl}, ${A.sets[n - 1] ?? 0}-${B.sets[n - 1] ?? 0} in set ${n || 1}`;
      const c = sw > sl ? (g <= -2 ? 'y' : 'g') : sw < sl ? (g >= 2 ? 'y' : 'r') : (g >= 2 ? 'g' : g <= -2 ? 'r' : 'y');
      return { c, why: sets };
    }
    const T = s.teams, rem = Math.max(0, 1 - s.frac), fin = s.state === 'post';
    const mine = T.find(t => same(leg.side, t.name) || same(leg.side, t.short)) || null, opp = mine && T.find(t => t !== mine);
    const tot = T[0].score + T[1].score;
    if (leg.kind === 'ml' || leg.kind === 'spread') {
      if (!mine) return null; const m = mine.score - opp.score + (leg.kind === 'spread' ? leg.line : 0);
      const why = leg.kind === 'spread' ? `Margin ${mine.score - opp.score > 0 ? '+' : ''}${mine.score - opp.score} vs ${leg.line > 0 ? '+' : ''}${leg.line}` : `${mine.score}-${opp.score} ${m > 0 ? 'lead' : m < 0 ? 'trail' : 'tied'}`;
      if (fin) return { c: m > 0 ? 'g' : m < 0 ? 'r' : 'y', why, fin: 1 };
      if (s.frac < 0.05) return { c: 'y', why };
      return { c: lvl(m / ((SD[sport] || 10) * Math.sqrt(Math.max(rem, 0.02)))), why };
    }
    if (leg.kind === 'total' || leg.kind === 'team_total') {
      const pts = leg.kind === 'team_total' && mine ? mine.score : tot, over = leg.ou === 'O';
      if (fin) return { c: (over ? pts > leg.line : pts < leg.line) ? 'g' : 'r', why: `Final ${pts} vs ${leg.line}`, fin: 1 };
      if (pts > leg.line) return { c: over ? 'g' : 'r', why: `${pts} already over ${leg.line}` };
      const pace = s.frac > 0 ? pts / s.frac : 0, need = Math.ceil(leg.line - pts + 0.01);
      const why = `Pace ${pace.toFixed(sport === 'NHL' ? 1 : 0)} vs line ${leg.line} · ${need} more to go over`;
      if (s.frac < 0.15) return { c: 'y', why };
      const d = (over ? pace - leg.line : leg.line - pace) / leg.line; return { c: d >= 0.04 ? 'g' : d <= -0.04 ? 'r' : 'y', why };
    }
    if (leg.kind === 'prop') {
      if (!s.stat) return { c: 'y', why: 'Player stats not posted yet' };
      const v = s.stat.v, over = leg.ou === 'O', pace = s.frac > 0 ? v / s.frac : 0, L = leg.line;
      const why = `${v} ${leg.stat} so far vs ${L}` + (s.frac > 0.1 && !fin && !(over && v > L) ? ` · pace ${pace.toFixed(1)}` : '');
      if (fin) return { c: (over ? v > L : v < L) ? 'g' : 'r', why, fin: 1 };
      if (over) return { c: v > L ? 'g' : pace >= 1.15 * L ? 'g' : pace < 0.85 * L && s.frac >= 0.5 ? 'r' : 'y', why };
      if (v > L) return { c: 'r', why };
      return { c: pace <= 0.85 * L || (s.frac >= 0.75 && L - v >= 1) ? 'g' : pace > 1.15 * L ? 'r' : 'y', why };
    }
    return null;
  }
  const RANK = { r: 0, y: 1, g: 2 }, LABEL = { g: 'On pace', y: 'Close', r: 'Off pace' };
  /* ---------- render ---------- */
  function scoreHtml(s) {
    if (s.state === 'unverified' || (!s.tennis && !s.teams)) return '';
    if (s.tennis) return `<table class="lv-t">${s.tennis.map(p => `<tr><th>${esc(p.name)}</th>${p.sets.map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}</table>`;
    return `<table class="lv-t">${s.teams.map(t => `<tr><th>${esc(t.name)}</th><td class="sc">${s.state === 'pre' ? '' : t.score}</td></tr>`).join('')}</table>`;
  }
  function legGrade(r) {
    if (!r || !r.s || r.s.state === 'unverified' || (r.m && r.m.unverified)) return 'unverified';
    if (r.s.state === 'pre' || r.s.state === 'in' || !r.m || !r.m.fin) return 'pending';
    return r.m.c === 'g' ? 'W' : r.m.c === 'r' ? 'L' : 'P';
  }
  function settleTicket(c, res) {
    const grades = res.map(legGrade);
    const ticket = ticketOf(c);
    const summary = { ticket, grades, settled: null, fin: false };
    if (ticket === 'round_robin') return summary; // combinations settle separately; show per-leg only
    if (ticket === 'parlay' || ticket === 'sgp') {
      if (grades.includes('L')) { summary.settled = 'L'; summary.fin = true; return summary; }
      if (grades.includes('pending') || grades.includes('unverified')) return summary;
      const live = grades.filter(g => g !== 'P');
      if (!live.length) { summary.settled = 'P'; summary.fin = true; return summary; }
      if (live.every(g => g === 'W')) { summary.settled = 'W'; summary.fin = true; return summary; }
      return summary;
    }
    const g = grades[0];
    if (g === 'W' || g === 'L' || g === 'P') { summary.settled = g; summary.fin = true; }
    return summary;
  }
  async function cardState(c) {
    const legs = c.espn.legs; const res = await Promise.all(legs.map((l, i) => (MOCK ? Promise.resolve(mockState(c.espn.sport, l, i + c.n)) : legState(c.espn.sport, l)).then(s => ({ l, s, m: meter(c.espn.sport, l, s) }))));
    const started = res.filter(r => r.m && !r.m.unverified); let worst = null;
    started.forEach(r => { if (!worst || RANK[r.m.c] < RANK[worst.m.c]) worst = r; });
    const set = settleTicket(c, res);
    const settledMeter = set.fin ? { c: set.settled === 'W' ? 'g' : set.settled === 'L' ? 'r' : 'y', why: set.settled === 'W' ? 'All live legs won' : set.settled === 'L' ? 'A leg lost' : 'Pushed', fin: 1 } : null;
    return { res, worst, live: res.some(r => r.s.state === 'in'), allPost: res.every(r => r.s.state === 'post'), ...set, settledMeter, multi: isMulti(c) };
  }
  function finLabel(m) { return m.c === 'g' ? 'Won' : m.c === 'r' ? 'Lost' : 'Push'; }
  function meterHtml(m, fin) { if (!m) return ''; const lab = fin ? finLabel(m) : (m.unverified ? 'Unverified' : LABEL[m.c]); return `<div class="lv-m ${m.c}" role="img" aria-label="${lab}"><i></i><span>${lab}</span></div>`; }
  function ticketLine(st) {
    if (!st.multi) return '';
    const n = st.grades.length, won = st.grades.filter(g => g === 'W').length, lost = st.grades.filter(g => g === 'L').length;
    const push = st.grades.filter(g => g === 'P').length, unv = st.grades.filter(g => g === 'unverified').length;
    const kind = st.ticket === 'sgp' ? 'SGP' : st.ticket === 'round_robin' ? 'Round robin' : 'Parlay';
    let msg;
    if (st.ticket === 'round_robin') msg = `${kind} · per-leg status (ticket settles by combination)`;
    else if (st.fin && st.settled === 'L') msg = `${kind} lost` + (lost ? ` — ${lost} of ${n} legs lost` : '');
    else if (st.fin && st.settled === 'W') msg = `${kind} won` + (push ? ` — ${push} push dropped` : '');
    else if (st.fin && st.settled === 'P') msg = `${kind} pushed`;
    else msg = `${kind} pending — ${won} won, ${lost} lost, ${n - won - lost - push - unv} still live` + (unv ? `, ${unv} unverified` : '') + (push ? `, ${push} push dropped` : '');
    return `<p class="lv-k">${esc(msg)}</p>`;
  }
  function popHtml(c, st) {
    const multi = st.multi;
    const legs = st.res.map(({ l, s, m }, i) => {
      const head = s.state === 'unverified' ? 'Score unverified' : s.state === 'pre' ? `Starts ${pt(s.start)}` : s.state === 'post' ? `Final${s.detail && s.detail !== 'Final' ? ' · ' + esc(s.detail) : ''}` : esc(s.detail || 'Live');
      const label = l.label || l.side || l.player || ('Leg ' + (i + 1));
      const finLeg = s.state === 'post' || s.state === 'unverified';
      return `<div class="lv-leg">${multi ? `<p class="lv-k">${esc(label)}</p>` : ''}<p class="lv-s ${s.state}">${s.state === 'in' ? '<b class="dot"></b>' : ''}${head}</p>${scoreHtml(s)}${m ? meterHtml(m, finLeg) + `<p class="lv-why">${esc(m.why)}</p>` : ''}</div>`;
    }).join('');
    return `${ticketLine(st)}${legs}<p class="lv-f">${MOCK ? 'Mock data for review · ' : ''}Scores via ESPN, may lag. Refreshes every 30s.</p>`;
  }
  let open = null, timer = null;
  function close() { if (!open) return; open.box.remove(); open.el.setAttribute('aria-expanded', 'false'); open.el.classList.remove('lv-open'); open = null; clearInterval(timer); timer = null; }
  async function fill(c, box) {
    try { const st = await cardState(c); if (open && open.box === box) box.querySelector('.lv-b').innerHTML = popHtml(c, st); paintRow(c, st); }
    catch (e) { if (open && open.box === box) box.querySelector('.lv-b').innerHTML = '<p class="lv-s">Live score unavailable</p>'; }
  }
  function toggle(el, c) {
    if (open && open.el === el) return close(); close();
    const box = document.createElement('div'); box.className = 'lv-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Live score');
    box.innerHTML = `<button class="lv-x" aria-label="Close">×</button><div class="lv-b"><p class="lv-s">Loading score…</p></div>`;
    box.addEventListener('click', e => { e.stopPropagation(); if (e.target.closest('.lv-x')) close(); });
    el.appendChild(box); el.setAttribute('aria-expanded', 'true'); el.classList.add('lv-open');
    // desktop: float beside the card (right if room, else left); phones (<760px): inline expand below the row (CSS)
    if (innerWidth >= 760) { const r = el.getBoundingClientRect(); box.classList.add(r.right + 330 < innerWidth ? 'side-r' : 'side-l'); }
    open = { el, box }; fill(c, box); timer = setInterval(() => document.hidden || fill(c, box), 30000);
  }
  function paintRow(c, st) {
    const el = document.querySelector(`.card[data-n="${c.n}"]`); if (!el) return;
    let slot = el.querySelector(':scope > .lv-row'); if (!slot) { slot = document.createElement('div'); slot.className = 'lv-row'; el.querySelector('dl').after(slot); }
    const hint = st.multi ? (st.fin ? 'Tap for legs' : st.live ? '<b class="dot"></b>Live · tap for legs' : 'Tap for legs') : (st.live ? '<b class="dot"></b>Live · tap for score' : st.fin ? 'Tap for result' : (st.res.every(r => r.s.state === 'pre') ? 'Tap for start time' : st.res.some(r => r.s.state === 'unverified') ? 'Tap for status' : 'Tap for score'));
    if (st.fin && st.settledMeter) {
      slot.innerHTML = meterHtml(st.settledMeter, true) + `<span class="lv-hint">${hint}</span>`;
      return;
    }
    const show = (st.live || (st.worst && st.worst.s && st.worst.s.state === 'post')) && st.worst;
    slot.innerHTML = show ? meterHtml(st.worst.m, false) + `<span class="lv-hint">${hint}</span>` : `<span class="lv-hint">${hint}</span>`;
  }
  async function rows(d) {
    const all = [...(d.picks || []), ...(d.awaiting || [])].filter(c => c.espn);
    all.forEach(c => {
      const el = document.querySelector(`.card[data-n="${c.n}"]`); if (!el || el.dataset.lv) return; el.dataset.lv = 1;
      el.addEventListener('click', e => { if (!e.target.closest('.lv-pop')) toggle(el, c); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(el, c); } if (e.key === 'Escape') close(); });
    });
    // row meters: only cards whose start time has passed (or mock); refresh every 60s while the tab is visible
    const due = all.filter(c => MOCK || !c.start || new Date(c.start) - Date.now() < 15 * 60e3);
    await Promise.all(due.map(c => cardState(c).then(st => paintRow(c, st)).catch(() => {})));
    all.filter(c => !due.includes(c)).forEach(c => paintRow(c, { res: c.espn.legs.map(() => ({ s: { state: 'pre' } })) }));
  }
  function boot(d) { rows(d); setInterval(() => document.hidden || rows(d), 60000); }
  document.addEventListener('keydown', e => e.key === 'Escape' && close());
  document.addEventListener('click', e => { if (open && !open.el.contains(e.target)) close(); });
  if (window.STS_DATA) boot(window.STS_DATA); else document.addEventListener('sts:data', e => boot(e.detail), { once: true });
})();
