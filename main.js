/* Purchase link for the Daily Betting Breakdown ($300/mo or $3,000/yr). Single slot: set to the checkout URL when it exists. '#' = checkout not open yet. */
const PURCHASE_URL = '#';
document.querySelectorAll('.js-purchase').forEach(a => {
  a.href = PURCHASE_URL;
  if (PURCHASE_URL === '#') a.addEventListener('click', e => { e.preventDefault(); document.querySelectorAll('.js-purchase-status').forEach(s => { s.textContent = 'Checkout opening soon. Check back shortly.'; s.style.color = '#A6FF00'; }); });
  else if (/^https?:/.test(PURCHASE_URL)) { a.target = '_blank'; a.rel = 'noopener'; }
});
document.querySelectorAll('.js-purchase-status').forEach(s => { if (PURCHASE_URL !== '#') s.textContent = 'Secure checkout'; });
/* Public Telegram invite link. Single slot: paste the t.me link here when it exists. Until then it points to the picks section. */
const TELEGRAM_URL = 'https://t.me/sweatthespread';
const tg = document.getElementById('tg-link');
if (tg) { tg.href = TELEGRAM_URL; if (/^https?:/.test(TELEGRAM_URL)) { tg.target = '_blank'; tg.rel = 'noopener'; } }

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowPower = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.deviceMemory && navigator.deviceMemory <= 2) || navigator.connection?.saveData;
if (reduced) document.documentElement.classList.add('reduced');

/* ---------- text scramble ---------- */
const GLYPHS = '0123456789+-–.%u#$@';
function scramble(el, dur = 900) {
  const final = el.dataset.final || el.textContent; el.dataset.final = final;
  if (reduced) { el.textContent = final; return; }
  const t0 = performance.now();
  (function tick(t) {
    const p = Math.min(1, (t - t0) / dur); let out = '';
    for (let i = 0; i < final.length; i++) {
      const c = final[i];
      out += (c === ' ' || i / final.length < p * 1.15 - 0.15) ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0];
    }
    el.textContent = p >= 1 ? final : out;
    if (p < 1) requestAnimationFrame(tick);
  })(t0);
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { scramble(e.target); io.unobserve(e.target); } }), { threshold: .6 });
document.querySelectorAll('.scramble').forEach(el => io.observe(el));

/* ---------- live data (data.json written by build_data.py) ---------- */
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const odds = o => (o > 0 ? '+' : '') + o, uu = u => u.toFixed(2) + 'u', sg = u => (u > 0 ? '+' : u < 0 ? '−' : '') + Math.abs(u).toFixed(2) + 'u';
const when = iso => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT'; };
function card(c) {
  const gap = c.gap != null ? `<div><dt>Gap</dt><dd class="scramble lime">${c.gap} pts</dd></div>` : '';
  return `<article class="card${c.gap != null ? ' gap' : ''}"><header><span class="lg">${esc(c.league)}</span><span class="mk">${esc(c.type)}${c.gap != null ? ' · Gap play' : ''}</span></header><h4>${esc(c.pick)}</h4><p class="m">${esc(c.matchup)} · ${when(c.start)}</p><dl><div><dt>Odds</dt><dd class="scramble">${odds(c.odds)}</dd></div><div><dt>Stake</dt><dd class="scramble">${uu(c.units)}</dd></div>${gap}</dl></article>`;
}
async function loadData() {
  if (!document.getElementById('latest')) return;
  try {
    const d = await (await fetch('/sts-site/data.json', { cache: 'no-cache' })).json(), r = d.record, $ = id => document.getElementById(id);
    $('r-wl').textContent = `${r.w}–${r.l}–${r.p}`; $('r-n').textContent = `${r.n} graded official bets`;
    $('r-u').textContent = sg(r.units); $('r-risk').textContent = `${r.risked.toFixed(2)}u risked`;
    if (r.roi != null) $('r-roi').textContent = (r.roi > 0 ? '+' : '') + r.roi.toFixed(2) + '%';
    const fmt = s => new Date(s + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    $('r-fine').textContent = `Official graded bets, ${fmt(r.first)} through ${fmt(r.last)}. ${d.pending} plays are pending and not in these totals. Past bets are a report, not a forecast. Updated ${d.updated}.`;
    calendar(d.daily || {});
    $('latest').innerHTML = d.latest.map(g => `<li><span class="lg">${esc(g.league)}</span><span class="g">${esc(g.matchup ? g.matchup + ': ' : '')}${esc(g.pick)}</span><span class="u ${g.pl > 0 ? 'win' : g.pl < 0 ? 'loss' : ''} scramble">${sg(g.pl)}</span></li>`).join('');
    $('cards-up').innerHTML = d.picks.length ? d.picks.map(card).join('') : '<p class="empty">No upcoming official plays yet. New plays post here first.</p>';
    $('cards-aw').innerHTML = d.awaiting.length ? d.awaiting.map(card).join('') : '<p class="empty">Nothing awaiting a result.</p>';
    $('p-upd').textContent = `Updated ${d.updated}.`;
    ['r-wl', 'r-u', 'r-roi'].forEach(id => { $(id).classList.add('scramble'); delete $(id).dataset.final; });
  } catch (e) { console.warn('data.json not loaded', e); }
  document.querySelectorAll('.scramble:not([data-final])').forEach(el => io.observe(el));
}
loadData();

/* ---------- smooth scroll + reveals (vendor scripts are deferred) ---------- */
function initMotion() {
  if (reduced || !window.gsap || !window.Lenis) { document.querySelectorAll('.reveal').forEach(e => e.style.opacity = 1); return; }
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ lerp: .09, smoothWheel: true });
  window.__lenis = lenis;
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(t => lenis.raf(t * 1000)); gsap.ticker.lagSmoothing(0);
  document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', e => { const t = document.querySelector(a.getAttribute('href')); if (t) { e.preventDefault(); lenis.scrollTo(t, { offset: -60 }); } }));
  gsap.utils.toArray('.reveal').forEach(el => gsap.to(el, { opacity: 1, y: 0, duration: .9, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 88%' } }));
  if (document.querySelector('.hero')) gsap.to('.hero-copy', { yPercent: -30, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
}
if (document.readyState === 'complete') initMotion(); else addEventListener('load', initMotion);

/* ---------- scroll progress for hero ---------- */
const heroProgress = () => Math.min(1, Math.max(0, scrollY / innerHeight));

/* ---------- 3D hero (lazy, only element using three.js) ---------- */
const host = document.getElementById('hero3d');
function canWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
if (host && !reduced && !lowPower && canWebGL()) {
  const start = () => import('./vendor/three.module.min.js').then(THREE => hero(THREE)).catch(e => console.warn('3D hero fallback', e));
  ('requestIdleCallback' in window) ? requestIdleCallback(start, { timeout: 800 }) : setTimeout(start, 200);
}
function hero(THREE) {
  const mobile = innerWidth < 760;
  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 1.75));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x07080a, 6, 16);
  const cam = new THREE.PerspectiveCamera(40, 1, .1, 50); cam.position.set(0, 0, 9);
  scene.add(new THREE.AmbientLight(0xffffff, .35));
  const key = new THREE.PointLight(0xc6ff00, 40, 30); key.position.set(3, 4, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x88aaff, .6); rim.position.set(-5, -2, -3); scene.add(rim);
  // ball built from glowing blocks on a fibonacci sphere, with seams like a basketball
  const N = mobile ? 420 : 720, R = 2.2;
  const geo = new THREE.BoxGeometry(.24, .24, .24);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .35, metalness: .2, emissive: 0x253300 });
  const mesh = new THREE.InstancedMesh(geo, mat, N); scene.add(mesh);
  const base = [], dir = [], rnd = [], heat = new Float32Array(N);
  const col = new THREE.Color(), dark = new THREE.Color(0x1a2008), lime = new THREE.Color(0xc6ff00), white = new THREE.Color(0xf4ffd0);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
    const v = new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
    dir.push(v.clone()); base.push(v.multiplyScalar(R));
    rnd.push(new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(2).add(dir[i].clone().multiplyScalar(2 + Math.random() * 3)));
    const seam = Math.abs(dir[i].x) < .06 || Math.abs(dir[i].y) < .06 || Math.abs(Math.hypot(dir[i].x, dir[i].z) - .75) < .05;
    mesh.setColorAt(i, seam ? lime : col.copy(dark).lerp(lime, Math.random() * .25));
  }
  const baseCol = []; for (let i = 0; i < N; i++) { const c = new THREE.Color(); mesh.getColorAt(i, c); baseCol.push(c); }
  const group = new THREE.Group(); scene.add(group); group.add(mesh);
  const ptr = new THREE.Vector2(9, 9), ray = new THREE.Raycaster(), hit = new THREE.Vector3(), sph = new THREE.Sphere(new THREE.Vector3(), R);
  let tx = 0, ty = 0;
  const onPtr = (x, y) => { ptr.set(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1); tx = ptr.x; ty = ptr.y; };
  addEventListener('pointermove', e => onPtr(e.clientX, e.clientY), { passive: true });
  addEventListener('touchmove', e => onPtr(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.position.z = w < h ? 13 : 9; group.position.y = w < h ? 1.3 : 0; cam.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), local = new THREE.Vector3(), inv = new THREE.Matrix4();
  let visible = true; new IntersectionObserver(([e]) => visible = e.isIntersecting).observe(host);
  const clock = new THREE.Clock(); host.classList.add('live');
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const t = clock.getElapsedTime(), sp = heroProgress(), burst = sp * sp * (3 - 2 * sp);
    group.rotation.y += .0035 + burst * .01; group.rotation.x += ((ty * .35) - group.rotation.x) * .05; group.position.x += ((mobile ? 0 : 1.6 + tx * .3) - group.position.x) * .05;
    group.updateMatrixWorld(); ray.setFromCamera(ptr, cam);
    const hasHit = ray.ray.intersectSphere(sph.set(group.position, R), hit);
    inv.copy(group.matrixWorld).invert(); if (hasHit) local.copy(hit).applyMatrix4(inv);
    for (let i = 0; i < N; i++) {
      const d = hasHit ? base[i].distanceTo(local) : 9;
      heat[i] += ((d < 1 ? 1 - d : 0) - heat[i]) * .12;
      p.copy(base[i]).addScaledVector(dir[i], heat[i] * .6 + Math.sin(t * 1.4 + i) * .02).lerp(rnd[i].clone().add(base[i]), burst);
      q.setFromAxisAngle(dir[i], t * .2 + burst * 4 + i); s.setScalar(1 + heat[i] * .5 - burst * .3);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      col.copy(baseCol[i]).lerp(white, heat[i]); mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    renderer.render(scene, cam);
  });
}

/* ---------- particle footer: morphs into social icons ---------- */
(function particles() {
  const cv = document.getElementById('particles'); if (!cv) return; const ctx = cv.getContext('2d'); const foot = cv.parentElement;
  let W, H, dpr, pts = [], targets = {}, cur = null, run = false;
  const COUNT = innerWidth < 760 ? 600 : 1100;
  const icon = {
    telegram(g) { g.beginPath(); g.moveTo(10, 46); g.lineTo(88, 14); g.lineTo(74, 86); g.lineTo(50, 66); g.lineTo(38, 82); g.lineTo(36, 60); g.closePath(); g.fill(); },
    x(g) { g.lineWidth = 12; g.lineCap = 'square'; g.beginPath(); g.moveTo(18, 14); g.lineTo(82, 86); g.moveTo(82, 14); g.lineTo(18, 86); g.stroke(); },
    youtube(g) { g.beginPath(); g.roundRect(6, 20, 88, 60, 18); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.moveTo(40, 36); g.lineTo(66, 50); g.lineTo(40, 64); g.closePath(); g.fill(); g.globalCompositeOperation = 'source-over'; },
    instagram(g) { g.lineWidth = 9; g.beginPath(); g.roundRect(12, 12, 76, 76, 22); g.stroke(); g.beginPath(); g.arc(50, 50, 17, 0, 7); g.stroke(); g.beginPath(); g.arc(72, 28, 5, 0, 7); g.fill(); }
  };
  function sample(name) {
    const c = document.createElement('canvas'); c.width = c.height = 100; const g = c.getContext('2d'); g.fillStyle = g.strokeStyle = '#fff'; icon[name](g);
    const d = g.getImageData(0, 0, 100, 100).data, out = [];
    for (let y = 0; y < 100; y += 2) for (let x = 0; x < 100; x += 2) if (d[(y * 100 + x) * 4 + 3] > 128) out.push([x / 100 - .5, y / 100 - .5]);
    return out;
  }
  Object.keys(icon).forEach(k => targets[k] = sample(k));
  function size() { dpr = Math.min(devicePixelRatio, 2); W = foot.clientWidth; H = foot.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  size(); addEventListener('resize', size);
  for (let i = 0; i < COUNT; i++) { const x = Math.random() * W, y = Math.random() * H; pts.push({ x, y, hx: x, hy: y, vx: 0, vy: 0, tx: null, ty: null }); }
  function setIcon(name) {
    cur = name;
    if (!name) { pts.forEach(p => p.tx = null); return; }
    const t = targets[name], S = Math.min(W, H) * (W < 760 ? .55 : .62), cx = W < 760 ? W / 2 : W * .7, cy = H * .38;
    pts.forEach((p, i) => { const k = t[(i * 7919) % t.length]; p.tx = cx + k[0] * S + (Math.random() - .5) * 2; p.ty = cy + k[1] * S + (Math.random() - .5) * 2; });
  }
  document.querySelectorAll('.socials a').forEach(a => {
    a.addEventListener('mouseenter', () => setIcon(a.dataset.icon)); a.addEventListener('focus', () => setIcon(a.dataset.icon));
    a.addEventListener('mouseleave', () => setIcon(null)); a.addEventListener('blur', () => setIcon(null));
    a.addEventListener('touchstart', () => setIcon(a.dataset.icon), { passive: true });
  });
  function frame(t) {
    if (!run) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#C6FF00';
    for (const p of pts) {
      const gx = p.tx ?? p.hx + Math.sin(t * .0004 + p.hy) * 20, gy = p.ty ?? p.hy + Math.cos(t * .0005 + p.hx) * 20;
      p.vx = (p.vx + (gx - p.x) * .02) * .86; p.vy = (p.vy + (gy - p.y) * .02) * .86; p.x += p.vx; p.y += p.vy;
      ctx.globalAlpha = p.tx == null ? .28 : .9; ctx.fillRect(p.x, p.y, 1.8, 1.8);
    }
    requestAnimationFrame(frame);
  }
  if (reduced) return;
  new IntersectionObserver(([e]) => { const was = run; run = e.isIntersecting; if (run && !was) requestAnimationFrame(frame); }).observe(foot);
})();

/* ---------- ambient sound (off by default, synthesized, no downloads) ---------- */
(function sound() {
  const btn = document.getElementById('sound'); let ac, master, on = false;
  function build() {
    ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = 0;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.connect(master); master.connect(ac.destination);
    [55, 82.4, 110, 164.8].forEach((f, i) => { const o = ac.createOscillator(); o.type = i % 2 ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = (Math.random() - .5) * 12; const g = ac.createGain(); g.gain.value = .05 / (i + 1);
      const lfo = ac.createOscillator(); lfo.frequency.value = .05 + i * .03; const lg = ac.createGain(); lg.gain.value = .02 / (i + 1); lfo.connect(lg); lg.connect(g.gain); lfo.start(); o.connect(g); g.connect(lp); o.start(); });
  }
  btn.addEventListener('click', () => {
    if (!ac) build(); on = !on; ac.resume();
    master.gain.cancelScheduledValues(ac.currentTime); master.gain.linearRampToValueAtTime(on ? .5 : 0, ac.currentTime + .8);
    btn.setAttribute('aria-pressed', on); btn.setAttribute('aria-label', on ? 'Ambient sound on' : 'Ambient sound off'); btn.querySelector('.lbl').textContent = on ? 'Sound on' : 'Sound off';
  });
  document.querySelectorAll('.btn,.socials a,.nav nav a').forEach(el => el.addEventListener('mouseenter', () => {
    if (!on) return; const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 1800 + Math.random() * 600; o.type = 'square'; g.gain.value = .015; g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .06); o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + .07);
  }));
})();

function calendar(D) {
  const g = document.getElementById('cal-g'); if (!g) return;
  const keys = Object.keys(D).sort(); const now = new Date();
  const first = keys.length ? keys[0].slice(0, 7) : null;
  let y = now.getFullYear(), mo = now.getMonth();
  const ym = (yy, mm) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  const fmt = u => (u > 0 ? '+' : u < 0 ? '\u2212' : '') + Math.abs(u).toFixed(2) + 'u';
  function draw() {
    const pre = ym(y, mo); const start = new Date(y, mo, 1).getDay(); const n = new Date(y, mo + 1, 0).getDate();
    let h = '', tot = 0, cnt = 0;
    for (let i = 0; i < start; i++) h += '<div class="cd e"></div>';
    for (let dd = 1; dd <= n; dd++) {
      const k = `${pre}-${String(dd).padStart(2, '0')}`, v = D[k];
      if (v) { tot += v.u; cnt += v.n; }
      const c = v ? (v.u > 0.004 ? 'up' : v.u < -0.004 ? 'dn' : '') : '';
      h += `<div class="cd ${c}" title="${v ? v.n + ' graded' : 'no graded plays'}"><span>${dd}</span>${v ? `<b>${fmt(v.u)}</b>` : ''}</div>`;
    }
    g.innerHTML = h;
    document.getElementById('cal-m').textContent = new Date(y, mo, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const t = Math.round(tot * 100) / 100;
    document.getElementById('cal-tot').innerHTML = cnt ? `Month total <b class="${t > 0 ? 'win' : t < 0 ? 'loss' : ''}">${fmt(t)}</b> on ${cnt} graded plays` : 'No graded plays this month';
    document.getElementById('cal-prev').disabled = !first || pre <= first;
    document.getElementById('cal-next').disabled = pre >= ym(now.getFullYear(), now.getMonth());
  }
  document.getElementById('cal-prev').onclick = () => { mo--; if (mo < 0) { mo = 11; y--; } draw(); };
  document.getElementById('cal-next').onclick = () => { mo++; if (mo > 11) { mo = 0; y++; } draw(); };
  draw();
}
