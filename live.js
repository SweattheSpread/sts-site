/* STS live score popover + likely-to-hit meter.
   Primaries and fallbacks are documented in live_sources.py.
   Browser calls CORS-enabled feeds (ESPN, MLB statsapi). Server-baked
   snapshots cover NHL official stats, tennis Challenger/ITF, and Odds API scores.
   Unmatched or missing scores show "Awaiting result" — never Push. */
(() => {
  const MOCK = false;
  const API = 'https://site.api.espn.com/apis/site/v2/sports/';
  const BOARD_Q = {
    'football/college-football': '&groups=80&limit=500',
    'basketball/mens-college-basketball': '&groups=50&limit=500'
  };
  const SD = { NBA: 12, WNBA: 10, NCAAB: 11, NFL: 13, NCAAF: 13, NHL: 2, MLB: 3.5, Soccer: 1.8 };
  const PER = { NBA: [4, 12], WNBA: [4, 10], NCAAB: [2, 20], NFL: [4, 15], NCAAF: [4, 15], NHL: [3, 20], MLB: [9, 0], Soccer: [2, 45] };
  const STAT = {
    points: ['PTS', 'points'], pts: ['PTS', 'points'], rebounds: ['REB', 'rebounds'],
    assists: ['A', 'AST', 'assists'], threes: ['3PT'],
    'shots on goal': ['S', 'shotsTotal'], sog: ['S', 'shotsTotal'],
    goals: ['G', 'goals'], hits: ['HT', 'hits', 'H'], strikeouts: ['K']
  };
  const NHLPTS = ['G', 'A', 'goals', 'assists'];
  const DUR = { Tennis: 4, NFL: 4, NCAAF: 4, NBA: 3.5, NCAAB: 3, NHL: 3.5, MLB: 4, Soccer: 2.5, WNBA: 3 };
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => (s || '').toLowerCase().replace(/[^a-z ]/g, '');
  const same = (a, b) => {
    a = norm(a); b = norm(b);
    if (!a || !b) return false;
    if (a === b || b.includes(a) || a.includes(b)) return true;
    const as = a.split(' ').filter(Boolean), bs = b.split(' ').filter(Boolean);
    return !!as.length && (as[as.length - 1] === bs[bs.length - 1] || (as[as.length - 1].length > 2 && b.includes(as[as.length - 1])));
  };
  const pt = iso => {
    const d = parsePT(iso); if (!d) return '';
    return d.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' PT';
  };
  function parsePT(iso) {
    if (!iso) return null;
    const s = String(iso).trim();
    if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) { const d = new Date(s); return isNaN(d) ? null : d; }
    const want = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
    for (const off of ['-08:00', '-07:00']) {
      const d = new Date(want + off);
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
      const wall = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
      if (wall.startsWith(want)) return d;
    }
    return new Date(want + '-08:00');
  }

  function ticketOf(c) {
    return c.ticket || c.espn?.ticket || (c.rr ? 'round_robin' : (/parlay/i.test(c.type || '') ? 'parlay' : /sgp/i.test(c.type || '') ? 'sgp' : 'single'));
  }
  function isMulti(c) {
    const t = ticketOf(c);
    return t === 'parlay' || t === 'sgp' || t === 'round_robin';
  }

  const cache = new Map();
  async function get(url) {
    const h = cache.get(url); if (h && Date.now() - h.t < 20000) return h.p;
    const p = fetch(url).then(r => { if (!r.ok) throw r.status; return r.json(); }); cache.set(url, { t: Date.now(), p });
    p.catch(() => cache.delete(url)); return p;
  }

  function clockFrac(sport, period, clock, state) {
    if (state === 'post') return 1; const pc = PER[sport]; if (!pc || !period) return 0;
    const [n, len] = pc; if (sport === 'MLB') return Math.min(1, (period - 1) / n + 0.05);
    const [m, s] = String(clock || '0:0').split(':').map(Number); const left = (m || 0) + (s || 0) / 60;
    return Math.min(1, ((Math.min(period, n) - 1) * len + (len - left)) / (n * len));
  }

  function readEspnStat(summary, sport, leg) {
    const player = leg.player; if (!player) return null;
    const nhlPts = sport === 'NHL' && /point/.test(leg.stat || '') && !/shot/.test(leg.stat || '');
    const keysWanted = nhlPts ? NHLPTS : (STAT[leg.stat] || [String(leg.stat || '').toUpperCase()]);
    for (const tm of summary.boxscore?.players || []) for (const grp of tm.statistics || []) {
      const labels = grp.labels || [], keynames = grp.keys || [];
      const idx = name => {
        const i = keynames.indexOf(name); if (i >= 0) return i;
        return labels.indexOf(name);
      };
      for (const a of grp.athletes || []) {
        const nm = a.athlete?.displayName || '';
        if (!same(player, nm)) continue;
        const stats = a.stats || [];
        if (nhlPts) {
          let v = 0, hit = false, seen = new Set();
          ['goals', 'G', 'assists', 'A', 'AST'].forEach(k => { const i = idx(k); if (i >= 0 && i < stats.length && !seen.has(i)) { seen.add(i); hit = true; v += parseFloat(String(stats[i]).split('-')[0]) || 0; } });
          return hit ? { v, name: nm } : null;
        }
        let v = 0, hit = false, seen = new Set();
        keysWanted.forEach(k => { const i = idx(k); if (i >= 0 && i < stats.length && !seen.has(i)) { seen.add(i); hit = true; v += parseFloat(String(stats[i]).split('-')[0]) || 0; } });
        if (hit) return { v, name: nm };
      }
    }
    return null;
  }

  function stateFromSummary(sport, leg, s) {
    const c = s.header?.competitions?.[0]; if (!c) throw 'nomatch';
    const st = c.status || {};
    const teams = (c.competitors || []).map(x => ({
      name: x.team?.displayName, short: x.team?.shortDisplayName, abbr: x.team?.abbreviation,
      score: +x.score || 0, ha: x.homeAway, winner: x.winner,
      linescores: (x.linescores || []).map(l => +l.value || 0)
    })).sort((a, b) => (a.ha === 'away' ? -1 : 1));
    const typ = st.type || {};
    const out = { state: typ.state, detail: typ.shortDetail || typ.detail, start: c.date, period: st.period, clock: st.displayClock, frac: clockFrac(sport, st.period, st.displayClock, typ.state), teams, source: 'espn' };
    if (leg.kind === 'prop' && out.state !== 'pre') out.stat = readEspnStat(s, sport, leg);
    return out;
  }

  function stateFromSnapshot(sport, snap) {
    if (!snap) return null;
    const frac = snap.state === 'post' ? 1 : (snap.frac != null ? snap.frac : clockFrac(sport, snap.period, snap.clock, snap.state) || (snap.state === 'in' ? 0.5 : 0));
    return { state: snap.state, detail: snap.detail, start: snap.start, period: snap.period, clock: snap.clock, teams: snap.teams, tennis: snap.tennis, stat: snap.stat, source: snap.source, frac, reason: snap.reason };
  }

  function stateFromBoardEvent(sport, leg, e) {
    const c = e.competitions[0], st = c.status;
    const teams = c.competitors.map(x => ({
      name: x.team.displayName, short: x.team.shortDisplayName, abbr: x.team.abbreviation,
      score: +x.score || 0, ha: x.homeAway, winner: x.winner,
      linescores: (x.linescores || []).map(l => +l.value || 0)
    })).sort((a, b) => (a.ha === 'away' ? -1 : 1));
    return { state: st.type.state, detail: st.type.shortDetail, start: e.date, period: st.period, clock: st.displayClock, frac: clockFrac(sport, st.period, st.displayClock, st.type.state), teams, source: 'espn' };
  }

  async function espnTennis(leg) {
    const b = await get(`${API}${leg.path}/scoreboard?dates=${leg.date}`);
    for (const e of b.events || []) for (const g of e.groupings || []) for (const c of g.competitions || []) if (c.id === leg.comp) {
      const st = c.status.type, pl = c.competitors.map(x => ({ name: x.athlete?.displayName || '?', winner: x.winner, sets: (x.linescores || []).map(l => l.value) }));
      return { state: st.state, detail: st.detail || st.shortDetail, start: c.date, tennis: pl, source: 'espn' };
    }
    throw 'nomatch';
  }

  async function mlbState(card, leg) {
    const start = parsePT(card.start); if (!start) throw 'nomatch';
    const et = new Date(start.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
    const b = await get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${ymd}&hydrate=linescore,team`);
    const matchup = card.matchup || '';
    for (const d of b.dates || []) for (const g of d.games || []) {
      const an = g.teams?.away?.team?.name || '', hn = g.teams?.home?.team?.name || '';
      if (!(same(an, matchup) || same(hn, matchup) || same(leg.side, an) || same(leg.side, hn))) continue;
      const stt = g.status?.abstractGameState || '';
      const state = stt === 'Final' ? 'post' : stt === 'Live' ? 'in' : 'pre';
      const teams = [
        { name: an, short: g.teams?.away?.team?.abbreviation, abbr: g.teams?.away?.team?.abbreviation, score: +(g.teams?.away?.score || 0), ha: 'away', winner: g.teams?.away?.isWinner, linescores: [] },
        { name: hn, short: g.teams?.home?.team?.abbreviation, abbr: g.teams?.home?.team?.abbreviation, score: +(g.teams?.home?.score || 0), ha: 'home', winner: g.teams?.home?.isWinner, linescores: [] }
      ];
      return { state, detail: g.status?.detailedState || stt, start: g.gameDate, period: g.linescore?.currentInning, clock: g.linescore?.inningState, frac: clockFrac('MLB', g.linescore?.currentInning, '', state), teams, source: 'mlb' };
    }
    throw 'nomatch';
  }

  async function legState(sport, leg, card) {
    const baked = stateFromSnapshot(sport, leg.snapshot);
    const tryEspnTeam = async () => {
      if (!leg.path || !leg.event || String(leg.path).startsWith('tennis')) throw 'nomatch';
      try {
        const s = await get(`${API}${leg.path}/summary?event=${leg.event}`);
        return stateFromSummary(sport, leg, s);
      } catch (e) {
        const b = await get(`${API}${leg.path}/scoreboard?dates=${leg.date}${BOARD_Q[leg.path] || ''}`);
        const ev = (b.events || []).find(x => String(x.id) === String(leg.event));
        if (!ev) throw 'nomatch';
        const out = stateFromBoardEvent(sport, leg, ev);
        if (leg.kind === 'prop' && out.state !== 'pre') {
          try { const s = await get(`${API}${leg.path}/summary?event=${leg.event}`); out.stat = readEspnStat(s, sport, leg); }
          catch (e2) { if (baked && baked.stat) out.stat = baked.stat; }
        }
        return out;
      }
    };
    try {
      if ((leg.path || '').startsWith('tennis') && leg.path !== 'tennis/explorer' && leg.comp) {
        return await espnTennis(leg);
      }
      if (sport === 'MLB') {
        try { return await mlbState(card || {}, leg); } catch (e) { /* fall through */ }
      }
      if (leg.path && leg.event && leg.path !== 'tennis/explorer') {
        return await tryEspnTeam();
      }
    } catch (e) { /* use snapshot or awaiting */ }
    if (baked && baked.state) return baked;
    return { state: 'unverified', detail: 'Awaiting result', reason: leg.reason || 'Score not yet available' };
  }

  function mockState(sport, leg, i) {
    if ((leg.path || '').startsWith('tennis') || sport === 'Tennis') return { state: 'in', detail: '3rd Set', tennis: [{ name: leg.side || 'Player A', sets: [6, 4, 3 + i % 2] }, { name: 'Opponent', sets: [3, 6, 2] }] };
    const f = [0.35, 0.6, 0.8][i % 3], P = PER[sport] || [3, 20], period = Math.min(P[0], 1 + Math.floor(f * P[0]));
    const teams = [{ name: 'Away Team', abbr: 'AWY', score: sport === 'NHL' ? 2 : 48, ha: 'away' }, { name: 'Home Team', abbr: 'HME', score: sport === 'NHL' ? 1 : 51, ha: 'home' }];
    if (leg.side) teams[0].name = leg.side;
    return { state: 'in', detail: `${['1st', '2nd', '3rd', '4th'][period - 1]} · 8:42`, period, clock: '8:42', frac: f, teams, stat: leg.kind === 'prop' ? { v: i % 2 ? 0 : Math.ceil(leg.line), name: leg.player } : null };
  }

  const lvl = (z, hi = 0.5) => (z >= hi ? 'g' : z <= -hi ? 'r' : 'y');

  function scopeDone(s, sport, scope) {
    if (!scope) return s.state === 'post';
    if (s.state === 'post') return true;
    const need = scope === '1P' ? 1 : (sport === 'NCAAB' ? 1 : 2);
    if ((s.period || 0) > need) return true;
    if ((s.period || 0) === need && /half/i.test(s.detail || '') && scope === '1H') return true;
    return false;
  }
  function scopedTeams(s, sport, scope) {
    if (!scope || !s.teams) return s.teams;
    const n = scope === '1P' ? 1 : (sport === 'NCAAB' ? 1 : 2);
    const has = s.teams.every(t => (t.linescores || []).length >= n && (t.linescores || []).slice(0, n).some(v => v > 0));
    if (!has) return null;
    return s.teams.map(t => ({ ...t, score: (t.linescores || []).slice(0, n).reduce((a, b) => a + (+b || 0), 0) }));
  }

  function meter(sport, leg, s) {
    if (s.state === 'unverified') return { c: 'w', why: s.reason || s.detail || 'Awaiting result — not matched to a score', unverified: 1 };
    if (s.state === 'pre') return null;
    if (s.tennis) {
      const me = s.tennis.findIndex(p => same(leg.side, p.name) || same(leg.player, p.name)), [A, B] = me === 1 ? [s.tennis[1], s.tennis[0]] : s.tennis;
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
        const won = A.winner === true || (A.winner == null && (A.sets.filter((v, i) => v > (B.sets[i] || 0)).length > B.sets.filter((v, i) => v > (A.sets[i] || 0)).length));
        return { c: won ? 'g' : 'r', why: won ? 'Won the match' : 'Lost the match', fin: 1 };
      }
      let sw = 0, sl = 0; const n = A.sets.length;
      for (let k = 0; k < n - 1; k++) A.sets[k] > B.sets[k] ? sw++ : sl++;
      const g = (A.sets[n - 1] || 0) - (B.sets[n - 1] || 0), sets = `Sets ${sw}-${sl}, ${A.sets[n - 1] ?? 0}-${B.sets[n - 1] ?? 0} in set ${n || 1}`;
      const c = sw > sl ? (g <= -2 ? 'y' : 'g') : sw < sl ? (g >= 2 ? 'y' : 'r') : (g >= 2 ? 'g' : g <= -2 ? 'r' : 'y');
      return { c, why: sets };
    }
    const scope = leg.scope;
    const teams = scopedTeams(s, sport, scope) || s.teams;
    if (!teams || !teams.length) return { c: 'w', why: 'Awaiting result', unverified: 1 };
    const T = teams, rem = Math.max(0, 1 - (s.frac || 0));
    const fin = scope ? scopeDone(s, sport, scope) && !!(scopedTeams(s, sport, scope)) : s.state === 'post';
    const mine = T.find(t => same(leg.side, t.name) || same(leg.side, t.short) || same(leg.side, t.abbr)) || null, opp = mine && T.find(t => t !== mine);
    const tot = (T[0].score || 0) + (T[1].score || 0);
    const scopeTag = scope ? ` (${scope})` : '';
    if (leg.kind === 'ml' || leg.kind === 'spread') {
      if (!mine) return { c: 'w', why: 'Awaiting result — team not found in score', unverified: 1 };
      const m = mine.score - opp.score + (leg.kind === 'spread' ? leg.line : 0);
      const why = (leg.kind === 'spread' ? `Margin ${mine.score - opp.score > 0 ? '+' : ''}${mine.score - opp.score} vs ${leg.line > 0 ? '+' : ''}${leg.line}` : `${mine.score}-${opp.score} ${m > 0 ? 'lead' : m < 0 ? 'trail' : 'tied'}`) + scopeTag;
      if (fin) return { c: m > 0 ? 'g' : m < 0 ? 'r' : 'y', why, fin: 1 };
      if ((s.frac || 0) < 0.05) return { c: 'y', why };
      return { c: lvl(m / ((SD[sport] || 10) * Math.sqrt(Math.max(rem, 0.02)))), why };
    }
    if (leg.kind === 'total' || leg.kind === 'team_total') {
      const pts = leg.kind === 'team_total' && mine ? mine.score : tot, over = leg.ou === 'O';
      if (leg.kind === 'team_total' && !mine) return { c: 'w', why: 'Awaiting result — team not found in score', unverified: 1 };
      if (fin) return { c: (over ? pts > leg.line : pts < leg.line) ? 'g' : (pts === leg.line ? 'y' : 'r'), why: `Final ${pts} vs ${leg.line}${scopeTag}`, fin: 1 };
      if (pts > leg.line) return { c: over ? 'g' : 'r', why: `${pts} already over ${leg.line}${scopeTag}` };
      const pace = s.frac > 0 ? pts / s.frac : 0, need = Math.ceil(leg.line - pts + 0.01);
      const why = `Pace ${pace.toFixed(sport === 'NHL' ? 1 : 0)} vs line ${leg.line} · ${need} more to go over${scopeTag}`;
      if ((s.frac || 0) < 0.15) return { c: 'y', why };
      const d = (over ? pace - leg.line : leg.line - pace) / leg.line; return { c: d >= 0.04 ? 'g' : d <= -0.04 ? 'r' : 'y', why };
    }
    if (leg.kind === 'prop') {
      if (!s.stat) return { c: 'y', why: s.state === 'post' ? 'Awaiting result — player stats not posted' : 'Player stats not posted yet' };
      const v = s.stat.v, over = leg.ou === 'O', pace = s.frac > 0 ? v / s.frac : 0, L = leg.line;
      const why = `${v} ${leg.stat} so far vs ${L}` + (s.frac > 0.1 && !fin && !(over && v > L) ? ` · pace ${pace.toFixed(1)}` : '');
      if (fin || s.state === 'post') return { c: (over ? v > L : v < L) ? 'g' : (v === L ? 'y' : 'r'), why, fin: 1 };
      if (over) return { c: v > L ? 'g' : pace >= 1.15 * L ? 'g' : pace < 0.85 * L && s.frac >= 0.5 ? 'r' : 'y', why };
      if (v > L) return { c: 'r', why };
      return { c: pace <= 0.85 * L || (s.frac >= 0.75 && L - v >= 1) ? 'g' : pace > 1.15 * L ? 'r' : 'y', why };
    }
    return null;
  }
  const RANK = { r: 0, y: 1, g: 2, w: 1 }, LABEL = { g: 'On pace', y: 'Close', r: 'Off pace', w: 'Awaiting result' };

  function scoreHtml(s) {
    if (s.state === 'unverified' || (!s.tennis && !s.teams)) return '';
    if (s.tennis) return `<table class="lv-t">${s.tennis.map(p => `<tr><th>${esc(p.name)}</th>${(p.sets || []).map(v => `<td>${v ?? ''}</td>`).join('')}</tr>`).join('')}</table>`;
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
    if (ticket === 'round_robin') return summary;
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
    const legs = (c.espn && c.espn.legs) || [];
    const sport = (c.espn && c.espn.sport) || c.league;
    const res = await Promise.all(legs.map((l, i) => (MOCK ? Promise.resolve(mockState(sport, l, i + c.n)) : legState(sport, l, c)).then(s => ({ l, s, m: meter(sport, l, s) })).catch(() => ({ l, s: { state: 'unverified', detail: 'Awaiting result' }, m: meter(sport, l, { state: 'unverified', detail: 'Awaiting result' }) }))));
    const started = res.filter(r => r.m && !r.m.unverified); let worst = null;
    started.forEach(r => { if (!worst || RANK[r.m.c] < RANK[worst.m.c]) worst = r; });
    const set = settleTicket(c, res);
    const settledMeter = set.fin ? { c: set.settled === 'W' ? 'g' : set.settled === 'L' ? 'r' : 'y', why: set.settled === 'W' ? (isMulti(c) ? 'All live legs won' : (res[0]?.m?.why || 'Won')) : set.settled === 'L' ? (isMulti(c) ? 'A leg lost' : (res[0]?.m?.why || 'Lost')) : 'Pushed', fin: 1 } : null;
    return { res, worst, live: res.some(r => r.s.state === 'in'), allPost: res.length && res.every(r => r.s.state === 'post' || r.s.state === 'unverified') && res.some(r => r.s.state === 'post'), ...set, settledMeter, multi: isMulti(c) };
  }
  function finLabel(m) { return m.c === 'g' ? 'Won' : m.c === 'r' ? 'Lost' : 'Push'; }
  function meterHtml(m, fin) {
    if (!m) return '';
    const awaiting = m.unverified || m.c === 'w';
    const lab = awaiting ? 'Awaiting result' : (fin && m.fin ? finLabel(m) : LABEL[m.c]);
    return `<div class="lv-m ${awaiting ? 'w' : m.c}" role="img" aria-label="${lab}"><i></i><span>${lab}</span></div>`;
  }
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
    else msg = `${kind} pending — ${won} won, ${lost} lost, ${n - won - lost - push - unv} still live` + (unv ? `, ${unv} awaiting result` : '') + (push ? `, ${push} push dropped` : '');
    return `<p class="lv-k">${esc(msg)}</p>`;
  }
  function popHtml(c, st) {
    const multi = st.multi;
    const legs = st.res.map(({ l, s, m }, i) => {
      const head = s.state === 'unverified' ? 'Awaiting result' : s.state === 'pre' ? `Starts ${pt(s.start || c.start)}` : s.state === 'post' ? `Final${s.detail && s.detail !== 'Final' ? ' · ' + esc(s.detail) : ''}` : esc(s.detail || 'Live');
      const label = l.label || l.side || l.player || ('Leg ' + (i + 1));
      const finLeg = !!(m && m.fin && !m.unverified);
      return `<div class="lv-leg">${multi ? `<p class="lv-k">${esc(label)}</p>` : ''}<p class="lv-s ${s.state}">${s.state === 'in' ? '<b class="dot"></b>' : ''}${head}</p>${scoreHtml(s)}${m ? meterHtml(m, finLeg) + `<p class="lv-why">${esc(m.why)}</p>` : ''}</div>`;
    }).join('');
    const src = [...new Set(st.res.map(r => r.s.source).filter(Boolean))];
    const via = src.length ? src.map(x => ({ espn: 'ESPN', nhl: 'NHL', mlb: 'MLB', 'tennis-explorer': 'Tennis Explorer', 'odds-api': 'odds feed' }[x] || x)).join(', ') : 'public score feeds';
    return `${ticketLine(st)}${legs}<p class="lv-f">${MOCK ? 'Mock data for review · ' : ''}Scores via ${via}, may lag. Refreshes every 30s. Display only — official grades post overnight.</p>`;
  }
  let open = null, timer = null;
  function close() { if (!open) return; open.box.remove(); open.el.setAttribute('aria-expanded', 'false'); open.el.classList.remove('lv-open'); open = null; clearInterval(timer); timer = null; }
  async function fill(c, box) {
    try { const st = await cardState(c); if (open && open.box === box) box.querySelector('.lv-b').innerHTML = popHtml(c, st); paintRow(c, st); place(c, st); }
    catch (e) { if (open && open.box === box) box.querySelector('.lv-b').innerHTML = '<p class="lv-s">Awaiting result</p>'; }
  }
  function toggle(el, c) {
    if (open && open.el === el) return close(); close();
    const box = document.createElement('div'); box.className = 'lv-pop'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Live score');
    box.innerHTML = `<button class="lv-x" aria-label="Close">×</button><div class="lv-b"><p class="lv-s">Loading score…</p></div>`;
    box.addEventListener('click', e => { e.stopPropagation(); if (e.target.closest('.lv-x')) close(); });
    el.appendChild(box); el.setAttribute('aria-expanded', 'true'); el.classList.add('lv-open');
    if (innerWidth >= 760) { const r = el.getBoundingClientRect(); box.classList.add(r.right + 330 < innerWidth ? 'side-r' : 'side-l'); }
    open = { el, box }; fill(c, box); timer = setInterval(() => document.hidden || fill(c, box), 30000);
  }
  function paintRow(c, st) {
    const el = document.querySelector(`.card[data-n="${c.n}"]`); if (!el) return;
    if (!c.espn) return;
    let slot = el.querySelector(':scope > .lv-row'); if (!slot) { slot = document.createElement('div'); slot.className = 'lv-row'; el.querySelector('dl')?.after(slot); }
    const hint = st.multi ? (st.fin ? 'Tap for legs' : st.live ? '<b class="dot"></b>Live · tap for legs' : 'Tap for legs') : (st.live ? '<b class="dot"></b>Live · tap for score' : st.fin ? 'Tap for result' : (st.res.every(r => !r.s || r.s.state === 'pre') ? 'Tap for start time' : st.res.some(r => r.s && r.s.state === 'unverified') ? 'Tap for status' : 'Tap for score'));
    if (st.fin && st.settledMeter) {
      slot.innerHTML = meterHtml(st.settledMeter, true) + `<span class="lv-hint">${hint}</span>`;
      return;
    }
    const show = (st.live || (st.worst && st.worst.s && st.worst.s.state === 'post') || (st.worst && st.worst.m && st.worst.m.fin)) && st.worst;
    slot.innerHTML = show ? meterHtml(st.worst.m, !!(st.worst.m && st.worst.m.fin)) + `<span class="lv-hint">${hint}</span>` : `<span class="lv-hint">${hint}</span>`;
  }
  function likelyOver(c) {
    const s = parsePT(c.start); if (!s) return false;
    return Date.now() - s.getTime() > (DUR[c.league] || 4) * 3600e3;
  }
  function bucket(c, st) {
    const start = parsePT(c.start);
    if (st && st.fin) return 'aw';
    if (st && st.live) return 'live';
    if (start && start.getTime() <= Date.now()) {
      if (st && st.allPost) return 'aw';
      if (st && st.res && st.res.length && st.res.every(r => r.s && r.s.state === 'unverified') && likelyOver(c)) return 'aw';
      if (!st && likelyOver(c)) return 'aw';
      return 'live';
    }
    return 'up';
  }
  function syncHeadings() {
    [['cards-up', 'h-up'], ['cards-live', 'h-live'], ['cards-aw', 'h-aw']].forEach(([id, hid]) => {
      const box = document.getElementById(id), h = document.getElementById(hid);
      const empty = !box || !box.querySelector('.card');
      if (box) box.classList.toggle('is-empty', empty);
      if (h) h.classList.toggle('is-empty', empty);
    });
  }
  function place(c, st) {
    const el = document.querySelector(`.card[data-n="${c.n}"]`); if (!el) return;
    const b = bucket(c, st);
    const host = document.getElementById(b === 'up' ? 'cards-up' : b === 'live' ? 'cards-live' : 'cards-aw');
    if (host && el.parentElement !== host) host.appendChild(el);
    syncHeadings();
  }
  async function rows(d) {
    const all = [...(d.picks || []), ...(d.awaiting || [])];
    all.forEach(c => {
      const el = document.querySelector(`.card[data-n="${c.n}"]`); if (!el || el.dataset.lv) return; el.dataset.lv = 1;
      if (c.espn) {
        el.addEventListener('click', e => { if (!e.target.closest('.lv-pop')) toggle(el, c); });
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(el, c); } if (e.key === 'Escape') close(); });
      }
    });
    const due = all.filter(c => MOCK || !c.start || (parsePT(c.start) && parsePT(c.start).getTime() - Date.now() < 15 * 60e3));
    await Promise.all(due.map(c => (c.espn ? cardState(c) : Promise.resolve({ res: [], live: !!(parsePT(c.start) && parsePT(c.start) <= new Date()), fin: false })).then(st => { paintRow(c, st); place(c, st); }).catch(() => { place(c, { res: [], live: true }); })));
    all.filter(c => !due.includes(c)).forEach(c => {
      if (c.espn) paintRow(c, { res: (c.espn.legs || []).map(() => ({ s: { state: 'pre' } })) });
      place(c, { res: [], live: false, fin: false });
    });
    syncHeadings();
  }
  function boot(d) { rows(d); setInterval(() => document.hidden || rows(d), 60000); }
  document.addEventListener('keydown', e => e.key === 'Escape' && close());
  document.addEventListener('click', e => { if (open && !open.el.contains(e.target)) close(); });
  if (window.STS_DATA) boot(window.STS_DATA); else document.addEventListener('sts:data', e => boot(e.detail), { once: true });
})();
