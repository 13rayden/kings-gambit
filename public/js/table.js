'use strict';

/* King's Gambit table client. The server sends a filtered view; this file only
   renders it and sends the player's intents back. */

const roomId = location.pathname.split('/').pop();
const tokenKey = `kg:token:${roomId}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const $ = (id) => document.getElementById(id);
const els = {
  seats: $('seats'), center: $('center'), actions: $('actions'), feed: $('feed'),
  roundInfo: $('roundInfo'), toast: $('toast'),
  sitModal: $('sitModal'), sitForm: $('sitForm'), nameInput: $('nameInput'), sitCancel: $('sitCancel'),
  chatForm: $('chatForm'), chatInput: $('chatInput'),
};

/* Seat positions around the table (percent of the table box), starting with
   your own seat at the bottom and going clockwise. */
const WIDE = [[50, 85], [16, 78], [6, 45], [17, 11], [50, 5], [83, 11], [94, 45], [84, 78]];
const TALL = [[50, 89], [13, 72], [12, 47], [13, 22], [50, 7], [87, 22], [88, 47], [87, 72]];

let view = null;
let matchArmed = false;
let lastDiscardSig = '';
let feedSig = '';
let pendingSeat = null;
let timerTick = null;
let turnEndsAt = null;

const socket = io();

socket.on('connect', () => {
  socket.emit('join', { roomId, token: store.get(tokenKey) }, (res) => {
    if (!res.ok) {
      toast(res.error);
      setTimeout(() => { location.href = '/?missing=1'; }, 1500);
    }
  });
});
socket.on('state', (v) => {
  const prev = view;
  // Where the piles were before this update: a card leaving the drawn spot flies from here.
  const pileRects = capturePileRects();
  view = v;
  if (!canMatch()) matchArmed = false;
  turnEndsAt = v.turnMsLeft != null ? Date.now() + v.turnMsLeft : null;
  const fresh = newMotions(v);
  render();
  animate(prev, fresh, pileRects);
});
socket.on('problem', toast);

function send(event, payload = {}) {
  socket.emit(event, payload, (res) => {
    if (res && !res.ok) toast(res.error);
  });
}
const act = (action) => send('act', action);

// ---------- helpers ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const myId = () => (view.me ? view.me.id : null);
const nameOf = (id) => (view.seats.find((s) => s && s.id === id) || { name: 'Someone' }).name;
const isHost = () => !!view.me && view.hostId === view.me.id;
const myTurn = () => !!view.me && view.turnId === view.me.id;
const inPlay = () => ['turn', 'drawn', 'power'].includes(view.phase);
const between = () => view.phase === 'lobby' || view.phase === 'reveal';
const label = (c) => c.label; // "7 of Triangles": the server's wording, same as the game log
const knockers = () => view.knockers || [];
const knockerNames = () => knockers().map(nameOf).map(esc).join(' & ');

/* The server says which cards you may try to match; empty means you can't match now. */
function canMatch() {
  return !!view && view.matchTargets.length > 0;
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

/* The first four slots keep their 2×2 spots (top row 0 1, bottom row 2 3) so
   players can trust their memory; penalty cards add columns to the right. */
function slotPlace(slot) {
  if (slot < 4) return `grid-row:${Math.floor(slot / 2) + 1};grid-column:${(slot % 2) + 1}`;
  return `grid-row:${((slot - 4) % 2) + 1};grid-column:${3 + Math.floor((slot - 4) / 2)}`;
}

function cardHTML(c, { classes = '', owner = null, slot = null } = {}) {
  const data = owner != null ? ` data-owner="${esc(owner)}" data-slot="${slot}" style="${slotPlace(slot)}"` : '';
  if (c === null) return `<div class="card empty ${classes}"${data}></div>`;
  if (c.hidden) return `<div class="card back ${classes}"${data}></div>`;
  return `<div class="card face ${CARDS.faceClasses(c)} ${classes}"${data} title="${esc(label(c))}">${CARDS.faceSVG(c)}</div>`;
}

// ---------- what a tap on a card would do ----------

/* The server lists the cards you may tap and what each does; this only looks them up. */
function cardIntent(owner, slot) {
  const list = matchArmed ? view.matchTargets : view.targets;
  const t = list.find((x) => x.owner === owner && x.slot === slot);
  if (!t) return null;
  return { kind: matchArmed ? 'match' : t.kind };
}

function onCardTap(owner, slot) {
  const intent = cardIntent(owner, slot);
  if (!intent) return;
  switch (intent.kind) {
    case 'match':
      matchArmed = false;
      act({ type: 'match', owner, slot });
      break;
    case 'give': act({ type: 'give', slot }); break;
    case 'swap': act({ type: 'swap', slot }); break;
    case 'pick': act({ type: 'pick', owner, slot }); break;
  }
  render();
}

function toggleMatch() {
  if (!canMatch()) return;
  matchArmed = !matchArmed;
  render();
}

// ---------- rendering ----------

function render() {
  if (!view) return;
  renderSeats();
  renderCenter();
  renderActions();
  renderFeed();
  els.roundInfo.textContent = view.round ? `ROUND ${view.round}` : 'LOBBY';
  scheduleTimer();
}

function seatPositions() {
  return window.innerWidth <= 640 ? TALL : WIDE;
}

function renderSeats() {
  const positions = seatPositions();
  const base = view.me ? view.me.seat : 0;
  const winners = view.result ? view.result.winners : [];
  let html = '';
  for (let seatNo = 0; seatNo < 8; seatNo++) {
    const rel = (seatNo - base + 8) % 8;
    const [x, y] = positions[rel];
    const s = view.seats[seatNo];
    const style = `left:${x}%;top:${y}%`;
    if (!s) {
      html += `<div class="seat" style="${style}">${emptySeatHTML(seatNo)}</div>`;
      continue;
    }
    const mine = s.id === myId();
    const cls = ['seat'];
    if (mine) cls.push('me');
    if (view.turnId === s.id && view.phase !== 'reveal') cls.push('turn');
    if (s.status === 'out') cls.push('out');
    if (!s.connected) cls.push('offline');
    if (winners.includes(s.id)) cls.push('winner');

    const cards = s.hand.map((c, slot) => {
      const classes = [];
      const key = `${s.id}:${slot}`;
      if (FX.isHidden(key)) classes.push('in-flight');
      if (c && FX.lookedBy(key)) classes.push('looked');
      const intent = cardIntent(s.id, slot);
      if (intent) classes.push(intent.kind === 'match' ? 'match-target' : 'selectable');
      if (view.power && view.power.picks.some((p) => p.owner === s.id && p.slot === slot)) classes.push('picked');
      if (c && !c.hidden && view.phase !== 'reveal' && view.phase !== 'knockReveal') classes.push('peek');
      return cardHTML(c, { classes: classes.join(' '), owner: s.id, slot });
    }).join('');

    const tags = [];
    if (s.knocked && s.knockTotal == null) tags.push('<span class="tag knock">KNOCKED 🛡</span>');
    if (s.status === 'out') tags.push('<span class="tag out">OUT</span>');
    if (winners.includes(s.id)) tags.push('<span class="tag win">WINNER</span>');
    if (s.owesCard) tags.push('<span class="tag owes">GIVING</span>');
    let sub = s.isBot ? 'Bot' : s.id === view.hostId ? 'Host' : '';
    if (s.total != null) sub = `Total: ${s.total}`;
    if (s.knockTotal != null) sub = `Reveals ${s.knockTotal}`;
    const removable = isHost() && between() && !mine;
    const wins = s.wins ? `<span class="wins" title="${s.wins} win${s.wins > 1 ? 's' : ''}">🏆 ${s.wins}</span>` : '';

    html += `<div class="${cls.join(' ')}" data-player="${esc(s.id)}" style="${style}">
      <div class="hand">${cards}${drawnSlotHTML(s, x)}</div>
      <div class="plate">
        ${removable ? `<button class="seat-remove" data-remove="${seatNo}" title="Remove">×</button>` : ''}
        <div class="name"><span class="who">${esc(s.name)}${mine ? ' (you)' : ''}</span>${wins}</div>
        <div class="sub">${tags.join('') || esc(sub)}</div>
        ${view.turnId === s.id && turnEndsAt ? '<div class="timer" data-timer></div>' : ''}
      </div>
    </div>`;
  }
  els.seats.innerHTML = html;
}

/* The card a player just drew waits beside their hand (on the side facing the
   middle of the table), so everyone can see whose turn it is. */
function drawnSlotHTML(s, x) {
  if (!view.drawn || view.turnId !== s.id) return '';
  const classes = ['drawn-card', s.id === myId() ? 'peek' : '', FX.isHidden('drawn') ? 'in-flight' : ''].join(' ');
  const side = x > 55 ? 'left' : 'right';
  return `<div class="drawn-slot ${side}" data-pile="drawn">${cardHTML(view.drawn, { classes })}</div>`;
}

function emptySeatHTML(seatNo) {
  const canSit = !view.me && between();
  const canBot = isHost() && between();
  const buttons = [
    canSit ? `<button data-sit="${seatNo}">SIT</button>` : '',
    canBot ? `<button data-bot="${seatNo}">+ BOT</button>` : '',
  ].join('');
  return `<div class="empty-seat"><span class="num">${seatNo + 1}</span>${buttons || 'EMPTY'}</div>`;
}

function renderCenter() {
  const parts = [];
  const banner = bannerText();
  if (banner) parts.push(`<div class="banner ${banner.tone || ''}">${banner.text}</div>`);

  if (view.phase === 'lobby') {
    parts.push(`<div class="share"><b>Share this link with your friends</b>
      <button class="btn btn-green btn-small" data-copy>Copy link</button></div>`);
  } else {
    const d = view.discard;
    const sig = d.top ? `${d.count}:${label(d.top)}` : '';
    const pop = sig && sig !== lastDiscardSig ? 'pop' : '';
    lastDiscardSig = sig;
    const topClasses = [pop, FX.isHidden('discard') ? 'in-flight' : ''].join(' ');
    const discardCards = d.top
      ? (d.second ? cardHTML(d.second) : '') + cardHTML(d.top, { classes: topClasses })
      : cardHTML(null);
    const pileCls = ['pile', 'discard-pile'];
    if (canMatch()) pileCls.push('armable');
    if (matchArmed) pileCls.push('armed');
    parts.push(`<div class="piles">
      <div class="pile" data-pile="deck"><div class="pile-stack">${view.deckCount ? cardHTML({ hidden: true }) : cardHTML(null)}</div>Deck · ${view.deckCount}</div>
      <div class="${pileCls.join(' ')}" data-discard title="${canMatch() ? 'Tap to match' : ''}"><div class="pile-stack">${discardCards}</div>${d.second ? 'Matched pair' : canMatch() ? 'Tap to match' : 'Discard'}</div>
    </div>`);
  }
  els.center.innerHTML = parts.join('');
}

function bannerText() {
  const p = view.phase;
  if (matchArmed) return { text: `Match mode — tap a card that's a ${view.discard.top.rank}. Wrong = penalty card. (Esc to cancel)`, tone: 'gold' };
  if (p === 'lobby') return { text: `Waiting for players · ${view.seats.filter(Boolean).length}/8 seated` };
  if (p === 'initialPeek') return { text: 'Memorize your bottom two cards!', tone: 'gold' };
  if (p === 'knockReveal') {
    const shown = view.seats.filter((x) => x && x.knockTotal != null);
    const allBust = shown.length > 0 && shown.every((x) => x.knockTotal > 5);
    const parts = shown.map((x) => `${esc(x.name)} ${x.knockTotal} — ${x.knockTotal > 5 ? 'OUT!' : 'safe!'}`);
    return { text: parts.join(' · ') || 'Revealing…', tone: allBust ? 'red' : 'gold' };
  }
  if (p === 'reveal' && view.result) {
    const names = view.result.winners.map(nameOf).map(esc).join(' & ');
    const best = view.result.totals[view.result.winners[0]];
    return { text: `🏆 ${names} win${view.result.winners.length > 1 ? '' : 's'} with ${best}`, tone: 'gold' };
  }
  if (inPlay()) {
    const who = myTurn() ? 'Your turn' : `${esc(nameOf(view.turnId))}'s turn`;
    return { text: knockers().length ? `${who} · final turns (${knockerNames()} knocked)` : who };
  }
  return null;
}

function renderActions() {
  const hint = [];
  const buttons = [];
  const p = view.phase;
  const me = view.me;

  if (!me) {
    hint.push(between() ? 'Pick an empty seat and tap <b>SIT</b> to join.' : 'You are watching. You can sit down when this round ends.');
  } else if (view.pendingGive) {
    hint.push(`Tap one of your cards to give to <b>${esc(nameOf(view.pendingGive.to))}</b>.`);
  } else if (p === 'lobby') {
    if (isHost()) {
      const count = view.seats.filter(Boolean).length;
      hint.push(`You're the host. Add bots or wait for friends, then start.<small>${count < 2 ? 'Need at least 2 players.' : `${count} players seated.`}</small>`);
      buttons.push(`<button class="btn" data-fill ${count >= 8 ? 'disabled' : ''}>Fill with bots</button>`);
      buttons.push(`<button class="btn btn-green" data-start ${count < 2 ? 'disabled' : ''}>Start game</button>`);
    } else {
      hint.push(`Waiting for <b>${esc(nameOf(view.hostId))}</b> to start the game…`);
    }
    buttons.push('<button class="btn btn-ghost" data-leave>Leave seat</button>');
  } else if (p === 'initialPeek') {
    hint.push('Your bottom two cards are face up — remember them!<small>They flip back in a few seconds.</small>');
    buttons.push(`<button class="btn btn-green" data-act="ready" ${view.ready ? 'disabled' : ''}>${view.ready ? 'Waiting for others…' : "Got it"}</button>`);
  } else if (p === 'reveal') {
    hint.push(isHost() ? 'Round over! Start another when everyone is ready.' : `Round over! Waiting for <b>${esc(nameOf(view.hostId))}</b> to start a new round.`);
    if (isHost()) buttons.push('<button class="btn btn-green" data-start>New round</button>');
    buttons.push('<button class="btn btn-ghost" data-leave>Leave seat</button>');
  } else if (me.status === 'out') {
    hint.push("You knocked over 5, so you're out this round. Watch the rest play out.");
  } else if (myTurn() && p === 'turn') {
    hint.push(knockers().length
      ? 'Your final turn — draw a card, or knock too if you think you have 5 or less (your cards get protected).'
      : 'Your turn — draw a card, or knock if you think you have 5 or less.');
    buttons.push('<button class="btn btn-green" data-act="draw">Draw</button>');
    if (!knockers().includes(me.id)) buttons.push(`<button class="btn btn-gold" data-act="knock">${knockers().length ? 'Knock too' : 'Knock'}</button>`);
  } else if (myTurn() && p === 'drawn') {
    const c = view.drawn;
    const power = view.drawnPower;
    const why = power ? `Discarding it uses its power: ${esc(power)}. ` : '';
    hint.push(`You drew <b>${label(c)}</b>. Tap one of your cards to swap it in, or discard it.<small>${why}If you swap, the card you replace is discarded and uses its power (7–K or Joker).</small>`);
    buttons.push(`<button class="btn btn-green" data-act="discard">Discard${power ? ' & use power' : ''}</button>`);
  } else if (myTurn() && p === 'power') {
    const pw = view.power;
    if (pw.step === 'select') {
      hint.push(`<b>${esc(pw.title)}</b> — ${esc(pw.help)}`);
      buttons.push('<button class="btn btn-ghost" data-act="skip">Skip power</button>');
    } else if (pw.step === 'viewing') {
      hint.push('Remember it! Tap Done when you have it.');
      buttons.push('<button class="btn btn-green" data-act="done">Done</button>');
    } else {
      hint.push('Swap these two cards?');
      buttons.push('<button class="btn btn-gold" data-act="kingSwap">Swap them</button>');
      buttons.push('<button class="btn" data-act="kingKeep">Keep as is</button>');
    }
  } else if (p === 'knockReveal') {
    hint.push(`${knockerNames()} ${knockers().length > 1 ? 'are' : 'is'} revealing…`);
  } else {
    hint.push(`Waiting for <b>${esc(nameOf(view.turnId))}</b>…`);
  }

  if (me && canMatch() && inPlay()) {
    buttons.push(`<button class="btn ${matchArmed ? 'btn-gold' : ''}" data-match>${matchArmed ? 'Cancel match' : `Match ${view.discard.top.rank}`}</button>`);
  }
  els.actions.innerHTML = `<div class="hint">${hint.join('')}</div>${buttons.length ? `<div class="buttons">${buttons.join('')}</div>` : ''}`;
}

function renderFeed() {
  const items = view.feed;
  // The server sends a capped window, so compare the newest entry, not the count.
  const last = items[items.length - 1];
  const sig = last ? `${items.length}:${last.t}:${last.text}` : '';
  if (sig === feedSig) return;
  feedSig = sig;
  els.feed.innerHTML = items.map((e) => (e.kind === 'chat'
    ? `<div class="chat"><b>${esc(e.from)}:</b> ${esc(e.text)}</div>`
    : `<div class="log">${esc(e.text)}</div>`)).join('');
  els.feed.scrollTop = els.feed.scrollHeight;
}

function scheduleTimer() {
  clearInterval(timerTick);
  if (!turnEndsAt) return;
  const update = () => {
    const bar = document.querySelector('[data-timer]');
    if (!bar) return;
    const left = Math.max(0, turnEndsAt - Date.now());
    bar.style.width = `${(left / view.turnMs) * 100}%`;
  };
  update();
  timerTick = setInterval(update, 500);
}

// ---------- motion ----------

/* The server lists public card movements (positions only). Each update plays the
   new ones over the freshly rendered table, then flips any card that turned face
   up or down in place. effects.js does the drawing. */

let lastMotionSeq = null; // null until the first update, so joining mid-game replays nothing

function newMotions(v) {
  const list = v.motions || [];
  const max = list.length ? list[list.length - 1].seq : 0;
  if (lastMotionSeq === null || max < lastMotionSeq) { // first update, or the server restarted
    lastMotionSeq = max;
    return [];
  }
  const fresh = list.filter((m) => m.seq > lastMotionSeq);
  lastMotionSeq = max;
  return fresh;
}

function capturePileRects() {
  const rect = (key) => {
    const node = document.querySelector(FX.selectorFor(key));
    return node ? node.getBoundingClientRect() : null;
  };
  return { deck: rect('deck'), drawn: rect('drawn'), discard: rect('discard') };
}

const slotKey = ({ owner, slot }) => `${owner}:${slot}`;
const nodeFor = (key) => document.querySelector(FX.selectorFor(key));
const topHTML = () => (view.discard.top ? cardHTML(view.discard.top) : FX.BACK);

function animate(prev, motions, piles) {
  if (!prev) return;
  const moved = new Set(); // slots a flight already handles, so they don't also flip
  motions.forEach((m, i) => playMotion(m, prev, piles, i * 140, moved));
  flipChanges(prev, moved);
  if (prev.phase !== 'reveal' && view.phase === 'reveal' && view.result) setTimeout(celebrateWin, 700);
}

function playMotion(m, prev, piles, delay, moved) {
  const me = myId();
  const deck = () => nodeFor('deck') || piles.deck;
  switch (m.kind) {
    case 'deal': {
      let n = 0;
      const flights = [];
      for (const h of m.hands) {
        for (let slot = 0; slot < h.count; slot++) {
          const key = `${h.owner}:${slot}`;
          moved.add(key);
          flights.push(FX.fly({ from: deck(), to: nodeFor(key), landKey: key, delay: delay + n++ * 30 }));
        }
      }
      // Once your cards land, the ones you may look at flip face up.
      Promise.all(flights).then(() => {
        const mine = view.seats.find((s) => s && s.id === me);
        if (mine) mine.hand.forEach((c, slot) => { if (c && !c.hidden) FX.flipReveal(nodeFor(`${me}:${slot}`)); });
      });
      break;
    }
    case 'draw':
      FX.fly({ from: deck(), to: nodeFor('drawn'), landKey: 'drawn', delay });
      break;
    case 'swapIn': {
      const key = `${m.by}:${m.slot}`;
      moved.add(key);
      const drawnFace = m.by === me && prev.drawn && !prev.drawn.hidden ? cardHTML(prev.drawn) : FX.BACK;
      FX.fly({ from: nodeFor(key), to: nodeFor('discard'), html: topHTML(), landKey: 'discard', delay, spin: 10 });
      FX.fly({ from: piles.drawn, to: nodeFor(key), html: drawnFace, landKey: key, delay: delay + 90, spin: -6 });
      break;
    }
    case 'discardDrawn':
      FX.fly({ from: piles.drawn, to: nodeFor('discard'), html: topHTML(), landKey: 'discard', delay, spin: 8 });
      break;
    case 'trade': {
      const a = slotKey(m.a);
      const b = slotKey(m.b);
      moved.add(a);
      moved.add(b);
      FX.fly({ from: nodeFor(a), to: nodeFor(b), landKey: b, delay, spin: -10 });
      FX.fly({ from: nodeFor(b), to: nodeFor(a), landKey: a, delay, spin: 10 });
      break;
    }
    case 'look':
      // You see your own peek as a flip; everyone else sees where your eyes went.
      if (m.by !== me) {
        FX.markLooked(m.cards.map(slotKey), nameOf(m.by));
        render();
      }
      break;
    case 'match': {
      const key = slotKey(m.from);
      moved.add(key);
      FX.fly({ from: nodeFor(key), to: nodeFor('discard'), html: topHTML(), landKey: 'discard', delay, spin: 12 });
      break;
    }
    case 'penalty': {
      const key = slotKey(m.to);
      moved.add(key);
      FX.shake(nodeFor(slotKey(m.tried)));
      FX.fly({ from: deck(), to: nodeFor(key), landKey: key, delay: delay + 380 });
      break;
    }
    case 'give': {
      const from = slotKey(m.from);
      const to = slotKey(m.to);
      moved.add(from);
      moved.add(to);
      FX.fly({ from: nodeFor(from), to: nodeFor(to), landKey: to, delay });
      break;
    }
    case 'joker': {
      // Every shuffled card flies into the middle and back out to a seat.
      const sample = m.spots.length ? nodeFor(slotKey(m.spots[0])) : null;
      const pileRow = document.querySelector('.piles');
      if (!sample || !pileRow) break;
      const s = sample.getBoundingClientRect();
      const p = pileRow.getBoundingClientRect();
      const middle = { left: p.left + p.width / 2 - s.width / 2, top: p.top + p.height / 2 - s.height / 2, width: s.width, height: s.height };
      m.spots.forEach((spot, i) => {
        const key = slotKey(spot);
        moved.add(key);
        const node = nodeFor(key);
        const stagger = delay + 250 + i * 25;
        FX.fly({ from: node, to: middle, landKey: key, delay: stagger, spin: 180 });
        FX.fly({ from: middle, to: node, landKey: key, delay: stagger + FX.FLIGHT_MS + 120, spin: -180 });
      });
      break;
    }
    default:
      break;
  }
}

/** Flips cards that turned face up (a peek, the reveal) or face down (a peek ending) in place. */
function flipChanges(prev, moved) {
  const faces = (v) => {
    const map = new Map();
    v.seats.forEach((s) => s && s.hand.forEach((c, slot) => { if (c) map.set(`${s.id}:${slot}`, c); }));
    return map;
  };
  const before = faces(prev);
  let n = 0;
  for (const [key, card] of faces(view)) {
    const old = before.get(key);
    if (!old || moved.has(key)) continue;
    if (old.hidden && !card.hidden) {
      // At the reveal every card turns over, one after another around the table.
      const stagger = view.phase === 'reveal' ? n++ * 40 : 0;
      setTimeout(() => FX.flipReveal(nodeFor(key)), stagger);
    } else if (!old.hidden && card.hidden) {
      FX.flipConceal(nodeFor(key), cardHTML(old));
    }
  }
}

function celebrateWin() {
  if (view.phase !== 'reveal' || !view.result) return;
  const { winners, totals } = view.result;
  const me = myId();
  const youWon = winners.includes(me);
  const best = totals[winners[0]];
  const names = winners.map(nameOf).join(' & ');
  let title = `${names} win${winners.length > 1 ? '' : 's'}!`;
  if (youWon) title = winners.length > 1 ? 'You tied for the win!' : 'You win!';
  FX.celebrate({
    winnerEls: winners.map((id) => document.querySelector(`[data-player="${CSS.escape(id)}"] .plate`)).filter(Boolean),
    title,
    subtitle: `with ${best} point${best === 1 ? '' : 's'}`,
    youWon,
  });
}

window.addEventListener('fx:changed', () => render());

// ---------- events ----------

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-owner],[data-discard],[data-act],[data-sit],[data-bot],[data-remove],[data-start],[data-fill],[data-leave],[data-copy],[data-match]');
  if (!t) return;
  const d = t.dataset;
  if (d.owner != null) onCardTap(d.owner, Number(d.slot));
  else if (d.discard != null) toggleMatch();
  else if (d.match != null) toggleMatch();
  else if (d.act) act({ type: d.act });
  else if (d.sit != null) openSit(Number(d.sit));
  else if (d.bot != null) send('addBot', { seat: Number(d.bot) });
  else if (d.remove != null) send('removeSeat', { seat: Number(d.remove) });
  else if (d.start != null) send('start');
  else if (d.fill != null) send('fillBots');
  else if (d.leave != null) {
    socket.emit('leave', {}, (res) => (res.ok ? store.del(tokenKey) : toast(res.error)));
  } else if (d.copy != null) {
    navigator.clipboard.writeText(location.href).then(() => toast('Link copied!'), () => toast(location.href));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'Escape' && matchArmed) {
    matchArmed = false;
    render();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMatch();
  }
});

function openSit(seat) {
  pendingSeat = seat;
  els.nameInput.value = store.get('kg:name') || '';
  els.sitModal.classList.remove('hidden');
  els.nameInput.focus();
}

els.sitForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = els.nameInput.value.trim();
  if (!name) return;
  socket.emit('sit', { seat: pendingSeat, name }, (res) => {
    if (!res.ok) return toast(res.error);
    store.set(tokenKey, res.token);
    store.set('kg:name', name);
    els.sitModal.classList.add('hidden');
  });
});
els.sitCancel.addEventListener('click', () => els.sitModal.classList.add('hidden'));

els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.chatInput.value.trim();
  if (!text) return;
  send('chat', { text });
  els.chatInput.value = '';
});

window.addEventListener('resize', () => render());
