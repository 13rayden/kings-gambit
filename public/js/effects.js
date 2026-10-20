'use strict';

/* King's Gambit table effects: card flights, flips, "someone looked here"
   highlights and the win celebration. table.js renders the table; this file
   only adds motion on top of it and never decides anything about the game. */

const FX = (() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FLIGHT_MS = reduced ? 0 : 480;
  const FLIP_MS = reduced ? 0 : 200;
  const LOOK_MS = 2600;

  let layer = null;
  const hidden = new Map(); // "owner:slot" or pile name -> count of flights landing there
  const looked = new Map(); // "owner:slot" -> { until, by }

  function overlay() {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'fx-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const centerOf = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  /** A card-shaped element positioned over `rect`, built from a source element's markup. */
  function ghost(html, rect) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const el = holder.firstElementChild;
    el.classList.remove('selectable', 'match-target', 'picked', 'peek', 'pop', 'looked', 'in-flight');
    el.classList.add('fx-ghost');
    el.removeAttribute('data-owner');
    el.style.cssText = `left:${rect.left}px;top:${rect.top}px;--w:${rect.width}px;`;
    overlay().appendChild(el);
    return el;
  }

  function hold(key) { hidden.set(key, (hidden.get(key) || 0) + 1); }
  function release(key) {
    const n = (hidden.get(key) || 0) - 1;
    if (n > 0) hidden.set(key, n);
    else hidden.delete(key);
  }

  /**
   * Flies a card from one element to another along a slight arc. The landing
   * spot stays hidden (via isHidden) until the card arrives, even if the table
   * re-renders mid-flight.
   */
  async function fly({ from, to, html, landKey, delay = 0, spin = 0 }) {
    if (!from || !to) return;
    // `from` / `to` are elements or rects remembered from before a re-render.
    const a = from instanceof Element ? from.getBoundingClientRect() : from;
    const b = to instanceof Element ? to.getBoundingClientRect() : to;
    if (!a.width || !b.width) return;
    if (landKey) hold(landKey);
    applyHidden();
    if (delay) await wait(delay);
    const el = ghost(html || BACK, a);
    const ca = centerOf(a);
    const cb = centerOf(b);
    const dx = cb.x - ca.x;
    const dy = cb.y - ca.y;
    const lift = Math.min(60, Math.hypot(dx, dy) * 0.18);
    const scale = b.width / a.width;
    const anim = el.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(1)', offset: 0 },
      { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) rotate(${spin / 2}deg) scale(${(1 + scale) / 2 * 1.12})`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(${scale})`, offset: 1 },
    ], { duration: FLIGHT_MS, easing: 'cubic-bezier(.45,.05,.3,1)' });
    await anim.finished.catch(() => {});
    el.remove();
    if (!landKey) return;
    release(landKey);
    const landed = document.querySelector(selectorFor(landKey));
    if (landed && !hidden.has(landKey)) {
      landed.classList.remove('in-flight');
      if (!reduced) landed.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
    }
  }

  /** Two cards trade places at once. */
  function trade(aKey, bKey, html = BACK) {
    const aEl = document.querySelector(selectorFor(aKey));
    const bEl = document.querySelector(selectorFor(bKey));
    return Promise.all([
      fly({ from: aEl, to: bEl, html, landKey: bKey, spin: -8 }),
      fly({ from: bEl, to: aEl, html, landKey: aKey, spin: 8 }),
    ]);
  }

  /** A wrong match: the card shakes "no". */
  function shake(el) {
    if (!el || reduced) return;
    el.animate([
      { transform: 'translateX(0)' }, { transform: 'translateX(-6px) rotate(-3deg)' }, { transform: 'translateX(6px) rotate(3deg)' },
      { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' },
    ], { duration: 420, easing: 'ease-in-out' });
  }

  /** Turns a face-down card face up: the back folds away, then the face unfolds. */
  async function flipReveal(el) {
    if (!el || reduced) return;
    const g = ghost(BACK, el.getBoundingClientRect());
    el.style.visibility = 'hidden';
    await g.animate([{ transform: 'perspective(600px) rotateY(0deg)' }, { transform: 'perspective(600px) rotateY(90deg)' }], { duration: FLIP_MS, easing: 'ease-in' }).finished.catch(() => {});
    g.remove();
    el.style.visibility = '';
    el.animate([{ transform: 'perspective(600px) rotateY(-90deg)' }, { transform: 'perspective(600px) rotateY(0deg)' }], { duration: FLIP_MS, easing: 'ease-out' });
  }

  /** Turns a face-up card back down. `faceHtml` is what the card showed a moment ago. */
  async function flipConceal(el, faceHtml) {
    if (!el || reduced || !faceHtml) return;
    const g = ghost(faceHtml, el.getBoundingClientRect());
    el.style.visibility = 'hidden';
    await g.animate([{ transform: 'perspective(600px) rotateY(0deg)' }, { transform: 'perspective(600px) rotateY(90deg)' }], { duration: FLIP_MS, easing: 'ease-in' }).finished.catch(() => {});
    g.remove();
    el.style.visibility = '';
    el.animate([{ transform: 'perspective(600px) rotateY(-90deg)' }, { transform: 'perspective(600px) rotateY(0deg)' }], { duration: FLIP_MS, easing: 'ease-out' });
  }

  /** Marks cards someone just looked at, so everyone can see where eyes went. */
  function markLooked(keys, byName) {
    const until = Date.now() + LOOK_MS;
    for (const key of keys) looked.set(key, { until, by: byName });
    setTimeout(() => window.dispatchEvent(new Event('fx:changed')), LOOK_MS + 50);
  }

  function lookedBy(key) {
    const entry = looked.get(key);
    if (!entry) return null;
    if (entry.until < Date.now()) {
      looked.delete(key);
      return null;
    }
    return entry.by;
  }

  const isHidden = (key) => hidden.has(key);

  function selectorFor(key) {
    if (!key) return null;
    if (key === 'discard') return '[data-discard] .pile-stack .card:last-child';
    if (key === 'deck' || key === 'drawn') return `[data-pile="${key}"] .card`;
    const [owner, slot] = key.split(':');
    return `[data-owner="${CSS.escape(owner)}"][data-slot="${slot}"]`;
  }

  /** Re-applies "waiting for a flying card" hiding after any re-render. */
  function applyHidden() {
    for (const key of hidden.keys()) {
      const el = document.querySelector(selectorFor(key));
      if (el) el.classList.add('in-flight');
    }
  }

  // ---------- confetti ----------

  const COLORS = ['#f2c14e', '#3fa45b', '#e0524c', '#5ec8ff', '#ffffff', '#c77dff', '#ff9f43'];

  /**
   * A burst of confetti. `origin` is a point in the viewport (e.g. the winner's
   * seat); `grand` adds a second wave raining from the top.
   */
  function confetti({ origin, grand = false } = {}) {
    if (reduced) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-confetti';
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    overlay().appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const o = origin || { x: innerWidth / 2, y: innerHeight * 0.45 };
    const parts = [];
    const add = (x, y, vx, vy) => parts.push({
      x, y, vx, vy,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      wobble: Math.random() * Math.PI * 2,
      circle: Math.random() < 0.25,
    });
    const burst = grand ? 220 : 140;
    for (let i = 0; i < burst; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const speed = 7 + Math.random() * 10;
      add(o.x, o.y, Math.cos(angle) * speed, Math.sin(angle) * speed);
    }
    if (grand) {
      setTimeout(() => {
        for (let i = 0; i < 160; i++) add(Math.random() * innerWidth, -20 - Math.random() * 200, (Math.random() - 0.5) * 3, 2 + Math.random() * 3);
      }, 450);
    }

    const start = performance.now();
    const life = grand ? 5200 : 3800;
    (function frame(now) {
      const t = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const fade = Math.max(0, Math.min(1, (life - t) / 900));
      for (const p of parts) {
        p.vy += 0.22;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.wobble += 0.12;
        p.x += p.vx + Math.sin(p.wobble) * 0.8;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.circle) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.wobble)));
        }
        ctx.restore();
      }
      if (t < life) requestAnimationFrame(frame);
      else canvas.remove();
    })(start);
  }

  /** The big moment: confetti from each winner's seat plus a rain for everyone, and a title card. */
  function celebrate({ winnerEls = [], title, subtitle, youWon }) {
    winnerEls.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      setTimeout(() => confetti({ origin: centerOf(r), grand: i === 0 }), i * 250);
    });
    if (!winnerEls.length) confetti({ grand: true });
    if (youWon) setTimeout(() => confetti({ origin: { x: innerWidth / 2, y: innerHeight * 0.9 }, grand: true }), 700);

    const card = document.createElement('div');
    card.className = `fx-win${youWon ? ' you' : ''}`;
    card.innerHTML = `<div class="fx-win-crown">♛</div><div class="fx-win-title"></div><div class="fx-win-sub"></div>`;
    card.querySelector('.fx-win-title').textContent = title;
    card.querySelector('.fx-win-sub').textContent = subtitle || '';
    overlay().appendChild(card);
    setTimeout(() => card.classList.add('leaving'), reduced ? 2500 : 3400);
    setTimeout(() => card.remove(), reduced ? 2900 : 4000);
  }

  const BACK = '<div class="card back"></div>';

  return { fly, trade, shake, wait, flipReveal, flipConceal, markLooked, lookedBy, isHidden, applyHidden, confetti, celebrate, selectorFor, BACK, FLIGHT_MS };
})();
