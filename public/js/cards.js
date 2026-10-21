'use strict';

/* King's Gambit card art. Each suit symbol is drawn once, in a hidden SVG sprite,
   and every card reuses it with <use>, so a symbol looks exactly the same on every
   card and at every size. This file only draws; it knows nothing about the rules
   (the server sends rank, suit, red and value). */

const CARDS = (() => {
  const NS = 'http://www.w3.org/2000/svg';

  // A tight spiral for the Uzumaki suit: three turns, growing outwards from the centre.
  function spiralPath() {
    const turns = 3;
    const steps = 160;
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * turns * Math.PI * 2;
      const r = 4 + t * 40;
      const x = (50 + r * Math.cos(angle)).toFixed(2);
      const y = (50 + r * Math.sin(angle)).toFixed(2);
      d += `${i ? 'L' : 'M'}${x},${y}`;
    }
    return d;
  }

  // Points on a circle, for the magic circle's hexagram and dots.
  const ring = (n, r, offset = -90) => Array.from({ length: n }, (_, i) => {
    const a = ((offset + (360 / n) * i) * Math.PI) / 180;
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  });
  const pts = (list) => list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

  function chipPins() {
    let d = '';
    for (const p of [36, 46, 54, 64]) {
      d += `M${p},26V14M${p},74V86M26,${p}H14M74,${p}H86`;
    }
    return d;
  }

  function starPath(outer, inner, points = 8) {
    const list = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? inner : outer;
      const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
      list.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
    }
    return `M${pts(list).replace(/ /g, 'L')}Z`;
  }

  const hex = ring(6, 36);
  const SYMBOLS = {
    // Illuminati triangle: an eye inside a triangle, with a few rays.
    triangle: `
      <path d="M50,10 L92,84 L8,84 Z"/>
      <path d="M50,2V-4M30,12L26,6M70,12L74,6M14,40L8,37M86,40L92,37"/>
      <path d="M28,60 Q50,42 72,60 Q50,78 28,60 Z"/>
      <circle cx="50" cy="60" r="8"/>
      <circle cx="50" cy="60" r="3" class="fill"/>
      <path d="M18,92H82"/>`,
    // Magic circle: double ring, hexagram, small runes on the ring and a centre dot.
    circle: `
      <circle cx="50" cy="50" r="46"/>
      <circle cx="50" cy="50" r="38"/>
      <polygon points="${pts([hex[0], hex[2], hex[4]])}"/>
      <polygon points="${pts([hex[1], hex[3], hex[5]])}"/>
      <circle cx="50" cy="50" r="12"/>
      <circle cx="50" cy="50" r="3" class="fill"/>
      ${ring(6, 42, -60).map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2" class="fill"/>`).join('')}`,
    // Cyberpunk chip: a package with pins on every side and a die in the middle.
    chip: `
      <rect x="26" y="26" width="48" height="48" rx="4"/>
      <rect x="37" y="37" width="26" height="26" rx="2"/>
      <path d="${chipPins()}"/>
      <path d="M44,44H56V56H44Z" class="fill"/>
      <circle cx="31" cy="31" r="1.8" class="fill"/>`,
    // Uzumaki: a spiral inside a thin ring.
    spiral: `
      <path d="${spiralPath()}"/>
      <circle cx="50" cy="50" r="47" class="thin"/>`,
    // Joker and card back motif: an eight-point compass star.
    star: `
      <circle cx="50" cy="50" r="44"/>
      <circle cx="50" cy="50" r="30" class="thin"/>
      <path d="${starPath(46, 12)}"/>
      <path d="${starPath(26, 8, 4)}" class="fill-soft"/>
      <circle cx="50" cy="50" r="3" class="fill"/>`,
  };

  // Simple line-art figures for J, Q and K. The suit symbol sits on the figure's chest.
  const HEADWEAR = {
    J: '<path d="M36,30 Q50,14 64,30 Z"/><path d="M60,24 L72,20"/>',
    Q: '<path d="M37,30 Q50,18 63,30"/><circle cx="50" cy="20" r="2.4" class="fill"/><circle cx="41" cy="24" r="1.8" class="fill"/><circle cx="59" cy="24" r="1.8" class="fill"/>',
    K: '<path d="M36,31 L36,18 L43,25 L50,14 L57,25 L64,18 L64,31 Z"/>',
  };
  function figure(rank, suit) {
    return `
      <g class="art">
        ${HEADWEAR[rank]}
        <circle cx="50" cy="41" r="10"/>
        <path d="M30,102 L33,66 Q50,54 67,66 L70,102"/>
        <path d="M40,54 L50,64 L60,54"/>
      </g>
      <use href="#ks-${suit}" x="37" y="68" width="26" height="26"/>`;
  }

  function injectSprite() {
    if (document.getElementById('kg-card-sprite')) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.id = 'kg-card-sprite';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = Object.entries(SYMBOLS)
      .map(([name, body]) => `<symbol id="ks-${name}" viewBox="-6 -6 112 112" class="sym">${body}</symbol>`)
      .join('');
    document.body.prepend(svg);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** The inner SVG of a face-up card (rank, suit icons, centre art). */
  function faceSVG(c) {
    if (c.rank === 'JOKER') {
      return `<svg viewBox="0 0 100 140" class="art-svg">
        <text x="9" y="22" class="rank joker-word">JOKER</text>
        <use href="#ks-star" x="18" y="38" width="64" height="64"/>
        <text x="91" y="118" class="rank joker-word" transform="rotate(180 91 118)">JOKER</text>
      </svg>`;
    }
    const face = c.rank === 'J' || c.rank === 'Q' || c.rank === 'K';
    const centre = face ? figure(c.rank, c.suit) : `<use href="#ks-${c.suit}" x="14" y="36" width="72" height="72"/>`;
    return `<svg viewBox="0 0 100 140" class="art-svg">
      <text x="8" y="30" class="rank">${esc(c.rank)}</text>
      <use href="#ks-${c.suit}" x="7" y="35" width="20" height="20"/>
      ${centre}
      <g transform="rotate(180 50 70)">
        <text x="8" y="30" class="rank">${esc(c.rank)}</text>
        <use href="#ks-${c.suit}" x="7" y="35" width="20" height="20"/>
      </g>
    </svg>`;
  }

  /** Extra classes for a face-up card: every King is red, Jokers are marked. */
  function faceClasses(c) {
    if (c.rank === 'JOKER') return 'joker';
    return c.rank === 'K' ? 'king' : '';
  }

  if (document.body) injectSprite();
  else document.addEventListener('DOMContentLoaded', injectSprite);

  return { faceSVG, faceClasses };
})();
