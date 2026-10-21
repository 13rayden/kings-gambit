'use strict';

const { makeDeck, shuffle, cardValue, sameRank, powerOf, cardLabel } = require('./cards');

const MAX_PLAYERS = 8;
const HAND_SIZE = 4;
/** Slots are numbered top-left, top-right, bottom-left, bottom-right. */
const INITIAL_PEEK_SLOTS = [2, 3];
const KNOCK_LIMIT = 5;
/** Phases in which anyone may match the top discard. */
const MATCH_PHASES = new Set(['turn', 'drawn', 'power']);

/**
 * The one place power descriptions live. `log` goes in the game log, `short` is the
 * hint shown with a drawn card, and `title` / `help` guide the player picking cards.
 */
const POWER_TEXT = {
  peekOwn: {
    title: '7 / 8',
    short: 'look at one of your cards',
    help: 'Tap one of your own cards to look at it.',
    log: 'look at one of their own cards',
  },
  peekOther: {
    title: '9 / 10',
    short: "look at someone else's card",
    help: "Tap one of someone else's cards to look at it.",
    log: "look at one of someone else's cards",
  },
  blindSwap: {
    title: 'Jack — blind swap',
    short: 'blind swap',
    help: "Tap two cards from two different players (yours or anyone else's) to swap them without looking.",
    log: 'blind swap',
  },
  peekTwo: {
    title: 'Queen',
    short: 'look at any two cards',
    help: "Tap any two cards (yours or anyone's) to look at them.",
    log: 'look at any two cards',
  },
  king: {
    title: 'King',
    short: 'look at two cards, swap if you want',
    help: 'Tap any two cards to look at them, then choose whether to swap them.',
    log: 'look at two cards and maybe swap them',
  },
  joker: {
    title: 'Joker',
    short: "shuffle everyone else's cards",
  },
};

class GameError extends Error {}

/** A pick or slot reduced to its public position (no card id). */
const spot = ({ owner, slot }) => ({ owner, slot });

/**
 * The full game state and rules. Pure logic with no I/O: callers apply actions
 * with act() and read the state; timers live in the server.
 *
 * A hand is an array of slots; a slot holds a card or null (an empty space
 * left by a match), so card positions stay stable for players' memory.
 */
class Game {
  constructor({ rng = Math.random } = {}) {
    this.rng = rng;
    this.players = []; // { id, name, isBot, seat, hand, status: 'active' | 'out' }
    this.phase = 'lobby'; // lobby | initialPeek | turn | drawn | power | knockReveal | reveal
    this.round = 0;
    this.deck = [];
    this.discard = [];
    this.topPaired = false;
    this.turnId = null;
    this.turnNo = 0;
    this.drawn = null;
    this.power = null; // { type, step: 'select' | 'viewing' | 'decide', picks: [{ owner, slot }] }
    this.knockers = []; // ids in the order they knocked; all of them are protected
    this.knockTotals = null; // { id: total } while the knockers' cards are shown
    this.starterId = null; // who took the first turn this round
    this.pendingGive = new Map(); // matcherId -> { to, slot }
    this.visible = new Map(); // playerId -> Set of "owner:slot" the player may currently see
    this.ready = new Set();
    this.result = null; // { winners: [id], totals: { id: n } }
    this.log = [];
    // Public card movements for the client to animate: positions only, never card identities.
    this.motions = []; // { seq, kind, ... }
    this.motionSeq = 0;
    this.version = 0;
  }

  // ---------- seating ----------

  addPlayer({ id, name, isBot = false, seat }) {
    if (!this.canChangeSeats()) throw new GameError('You can only sit down between rounds.');
    if (!Number.isInteger(seat) || seat < 0 || seat >= MAX_PLAYERS) throw new GameError('No such seat.');
    if (this.players.some((p) => p.seat === seat)) throw new GameError('That seat is taken.');
    if (this.players.some((p) => p.id === id)) throw new GameError('Already seated.');
    const player = { id, name, isBot, seat, hand: [], status: 'active', wins: 0 };
    this.players.push(player);
    this.players.sort((a, b) => a.seat - b.seat);
    this.version++;
    return player;
  }

  removePlayer(id) {
    if (!this.canChangeSeats()) throw new GameError('Players can only leave between rounds.');
    this.players = this.players.filter((p) => p.id !== id);
    this.version++;
  }

  canChangeSeats() {
    return this.phase === 'lobby' || this.phase === 'reveal';
  }

  // ---------- queries ----------

  player(id) {
    return this.players.find((p) => p.id === id) || null;
  }

  activePlayers() {
    return this.players.filter((p) => p.status === 'active');
  }

  isActive(id) {
    const p = this.player(id);
    return !!p && p.status === 'active';
  }

  isProtected(id) {
    return this.knockers.includes(id);
  }

  /** The first player to knock: final turns end when play gets back to them. */
  firstKnocker() {
    return this.knockers[0] || null;
  }

  canSee(viewerId, owner, slot) {
    if (this.phase === 'reveal') return true;
    if (this.phase === 'knockReveal' && this.isProtected(owner)) return true;
    const set = this.visible.get(viewerId);
    return !!set && set.has(`${owner}:${slot}`);
  }

  handTotal(id) {
    const p = this.player(id);
    return p.hand.reduce((sum, c) => sum + (c ? cardValue(c) : 0), 0);
  }

  topDiscard() {
    return this.discard[this.discard.length - 1] || null;
  }

  /** Whether the top discard can currently be matched by anyone. */
  matchOpen() {
    return MATCH_PHASES.has(this.phase) && !!this.topDiscard() && !this.topPaired;
  }

  /** Why `id` can't try a match right now, or null if they can. */
  matchProblem(id) {
    if (!MATCH_PHASES.has(this.phase)) return 'You can only match during play.';
    if (!this.isActive(id)) return 'You are not in this round.';
    if (this.isProtected(id)) return 'You knocked, so your hand is frozen.';
    if (this.pendingGive.has(id)) return 'Give a card to the player you matched first.';
    if (!this.topDiscard()) return 'There is nothing on the discard pile yet.';
    if (this.topPaired) return 'That card is already matched. No triple stacking.';
    return null;
  }

  /** The cards `id` may try to match right now (any unprotected card in play), or [] if they can't match. */
  matchTargets(id) {
    if (this.matchProblem(id)) return [];
    const targets = [];
    for (const p of this.activePlayers()) {
      if (this.isProtected(p.id)) continue;
      p.hand.forEach((card, slot) => { if (card) targets.push({ owner: p.id, slot }); });
    }
    return targets;
  }

  /**
   * The cards `id` may tap right now and what a tap does: `give` (a card owed
   * after a match), `swap` (the drawn card in) or `pick` (for a power).
   * Owing a card comes first, so on your own turn a tap gives rather than swaps.
   * Matching is separate: see matchTargets().
   */
  legalTargets(id) {
    const me = this.player(id);
    if (!me) return [];
    const targets = [];
    const add = (p, kind, ok = () => true) => p.hand.forEach((card, slot) => {
      if (card && ok(slot)) targets.push({ owner: p.id, slot, kind });
    });
    if (this.pendingGive.has(id)) {
      add(me, 'give');
    } else if (this.turnId === id && this.phase === 'drawn') {
      add(me, 'swap');
    } else if (this.turnId === id && this.phase === 'power' && this.power.step === 'select') {
      const picks = this.livePicks();
      for (const p of this.activePlayers()) add(p, 'pick', (slot) => !this.pickProblem(id, p.id, slot, picks));
    }
    return targets;
  }

  /** Power picks that still point at the card they picked (see pickStillValid). */
  livePicks() {
    return this.power.picks.filter((p) => this.pickStillValid(p));
  }

  /** Why `id` can't pick this card for the current power, or null if they can. The card must exist. */
  pickProblem(id, owner, slot, picks) {
    if (picks.some((p) => p.owner === owner && p.slot === slot)) return 'You already picked that card.';
    const own = owner === id;
    switch (this.power.type) {
      case 'peekOwn':
        return own ? null : 'Pick one of your own cards.';
      case 'peekOther':
        return own ? "Pick one of someone else's cards." : null;
      case 'blindSwap':
        if (this.isProtected(owner)) return "A knocker's cards are protected.";
        if (picks.some((p) => p.owner === owner)) return "Now pick a card from a different player.";
        return null;
      case 'peekTwo':
      case 'king':
        return null;
      default:
        return 'Nothing to pick.';
    }
  }

  // ---------- round flow ----------

  start() {
    if (!this.canChangeSeats()) throw new GameError('A round is already in progress.');
    if (this.players.length < 2) throw new GameError('Need at least 2 players.');
    const starter = this.nextStarter();
    this.round++;
    this.turnNo = 0;
    this.deck = shuffle(makeDeck(), this.rng);
    this.discard = [];
    this.topPaired = false;
    this.knockers = [];
    this.knockTotals = null;
    this.drawn = null;
    this.power = null;
    this.result = null;
    this.pendingGive.clear();
    this.visible.clear();
    this.ready.clear();
    for (const p of this.players) {
      p.status = 'active';
      p.hand = [];
      for (let i = 0; i < HAND_SIZE; i++) p.hand.push(this.deck.pop());
      for (const slot of INITIAL_PEEK_SLOTS) this.see(p.id, p.id, slot);
    }
    this.turnId = starter;
    this.starterId = starter;
    this.phase = 'initialPeek';
    this.motion('deal', { hands: this.players.map((p) => ({ owner: p.id, count: p.hand.length })) });
    this.addLog(`Round ${this.round} begins. Everyone looks at their bottom two cards.`);
    this.version++;
  }

  /**
   * Who goes first in the next round: the previous round's winner. With tied winners, the first
   * one clockwise after the previous starter. Round 1 (or no winner still seated) rotates by round.
   */
  nextStarter() {
    const winners = this.result ? this.players.filter((p) => this.result.winners.includes(p.id)) : [];
    if (winners.length) {
      const prev = this.player(this.starterId);
      const after = prev ? prev.seat : -1;
      return (winners.find((p) => p.seat > after) || winners[0]).id;
    }
    return this.players[this.round % this.players.length].id;
  }

  markReady(id) {
    if (this.phase !== 'initialPeek') throw new GameError('Nothing to be ready for.');
    if (!this.isActive(id)) throw new GameError('You are not in this round.');
    this.ready.add(id);
    if (this.activePlayers().every((p) => this.ready.has(p.id))) this.finishInitialPeek();
  }

  /** Ends the opening peek: everyone's bottom cards flip back face-down. */
  finishInitialPeek() {
    if (this.phase !== 'initialPeek') return;
    this.visible.clear();
    this.phase = 'turn';
    this.turnNo++;
    this.addLog(`Cards flip back. ${this.name(this.turnId)} goes first.`);
    this.version++;
  }

  // ---------- actions ----------

  /** Applies one action from a player. Throws GameError when it isn't allowed. */
  act(id, action) {
    if (!action || typeof action.type !== 'string') throw new GameError('Bad action.');
    switch (action.type) {
      case 'ready': this.markReady(id); break;
      case 'draw': this.draw(id); break;
      case 'knock': this.doKnock(id); break;
      case 'swap': this.swap(id, action.slot); break;
      case 'discard': this.discardDrawn(id); break;
      case 'pick': this.powerPick(id, action.owner, action.slot); break;
      case 'done': this.powerDone(id); break;
      case 'kingSwap': this.kingDecide(id, true); break;
      case 'kingKeep': this.kingDecide(id, false); break;
      case 'skip': this.skipPower(id); break;
      case 'match': this.match(id, action.owner, action.slot); break;
      case 'give': this.give(id, action.slot); break;
      default: throw new GameError('Unknown action.');
    }
    this.version++;
  }

  draw(id) {
    this.requireTurn(id, 'turn');
    const card = this.drawCard();
    if (!card) throw new GameError('The deck is empty.');
    this.drawn = card;
    this.phase = 'drawn';
    this.motion('draw', { by: id });
    this.addLog(`${this.name(id)} drew a card.`);
  }

  doKnock(id) {
    this.requireTurn(id, 'turn');
    if (this.isProtected(id)) throw new GameError('You have already knocked.');
    if (this.pendingGive.has(id)) throw new GameError('Give your card to the player you matched before knocking.');
    this.knockers.push(id);
    this.addLog(this.knockers.length === 1
      ? `${this.name(id)} knocked! Everyone else gets one last turn.`
      : `${this.name(id)} knocked too! Their cards are protected as well.`);
    // The knocker's hand is frozen, so nobody can hand them a card any more.
    for (const [matcher, pending] of this.pendingGive) {
      if (pending.to === id) {
        this.pendingGive.delete(matcher);
        this.addLog(`${this.name(id)}'s hand is frozen, so ${this.name(matcher)} keeps their card.`);
      }
    }
    this.endTurn();
  }

  swap(id, slot) {
    this.requireTurn(id, 'drawn');
    const me = this.player(id);
    const old = this.cardAt(id, slot);
    me.hand[slot] = this.drawn;
    this.drawn = null;
    this.forgetSlot(id, slot);
    this.motion('swapIn', { by: id, slot });
    this.addLog(`${this.name(id)} swapped the drawn card into their hand.`);
    this.discardWithPower(id, old);
  }

  discardDrawn(id) {
    this.requireTurn(id, 'drawn');
    const card = this.drawn;
    this.drawn = null;
    this.motion('discardDrawn', { by: id });
    this.discardWithPower(id, card);
  }

  /** The card a player puts on the pile this turn (drawn or swapped out) uses its power, if it has one. */
  discardWithPower(id, card) {
    this.pushDiscard(card);
    const type = powerOf(card);
    if (type === 'joker') {
      this.addLog(`${this.name(id)} played a Joker! Everyone else's cards are shuffled.`);
      this.jokerShuffle(id);
      this.endTurn();
    } else if (type) {
      this.power = { type, step: 'select', picks: [] };
      this.phase = 'power';
      this.addLog(`${this.name(id)} played ${cardLabel(card)}: ${POWER_TEXT[type].log}.`);
    } else {
      this.addLog(`${this.name(id)} discarded ${cardLabel(card)}.`);
      this.endTurn();
    }
  }

  powerPick(id, owner, slot) {
    this.requireTurn(id, 'power');
    const power = this.power;
    if (power.step !== 'select') throw new GameError('You have already picked.');
    if (!this.isActive(owner)) throw new GameError('That player is not in the round.');
    const card = this.cardAt(owner, slot);
    // A card picked earlier may have been matched or moved since; that pick no longer counts.
    power.picks = this.livePicks();
    const problem = this.pickProblem(id, owner, slot, power.picks);
    if (problem) throw new GameError(problem);

    power.picks.push({ owner, slot, cardId: card.id });
    const needed = power.type === 'peekOwn' || power.type === 'peekOther' ? 1 : 2;
    if (power.picks.length < needed) return;

    if (power.type === 'blindSwap') {
      const [a, b] = power.picks;
      this.swapSlots(a, b);
      this.motion('trade', { a: spot(a), b: spot(b) });
      const mine = a.owner === id || b.owner === id;
      this.addLog(mine
        ? `${this.name(id)} blind-swapped a card with ${this.name(a.owner === id ? b.owner : a.owner)}.`
        : `${this.name(id)} blind-swapped ${this.name(a.owner)}'s card with ${this.name(b.owner)}'s card.`);
      this.endTurn();
      return;
    }
    for (const p of power.picks) this.see(id, p.owner, p.slot);
    power.step = power.type === 'king' ? 'decide' : 'viewing';
    this.motion('look', { by: id, cards: power.picks.map(spot) });
    this.addLog(`${this.name(id)} looked at ${this.describePicks(id, power.picks)}.`);
  }

  /** Finishes a peek (or keeps the cards for a King). Also used by the server's timeout. */
  powerDone(id) {
    this.requireTurn(id, 'power');
    if (this.power.step === 'decide') return this.kingDecide(id, false);
    if (this.power.step !== 'viewing') throw new GameError('Pick a card first, or skip.');
    this.endTurn();
  }

  kingDecide(id, doSwap) {
    this.requireTurn(id, 'power');
    if (this.power.step !== 'decide') throw new GameError('Nothing to decide yet.');
    const [a, b] = this.power.picks;
    if (doSwap) {
      if (this.isProtected(a.owner) || this.isProtected(b.owner)) throw new GameError("The knocker's cards are protected.");
      if (!this.pickStillValid(a) || !this.pickStillValid(b)) throw new GameError('One of those cards has moved, so they cannot be swapped.');
      this.swapSlots(a, b);
      this.motion('trade', { a: spot(a), b: spot(b) });
      this.addLog(`${this.name(id)} swapped the two cards.`);
    } else {
      this.addLog(`${this.name(id)} left the cards where they were.`);
    }
    this.endTurn();
  }

  skipPower(id) {
    this.requireTurn(id, 'power');
    this.addLog(`${this.name(id)} skipped the power.`);
    this.endTurn();
  }

  /** Any active player, at any time during play, matches the top discard with a card of the same rank. */
  match(id, owner, slot) {
    const problem = this.matchProblem(id);
    if (problem) throw new GameError(problem);
    const top = this.topDiscard();
    if (!this.isActive(owner)) throw new GameError('That player is not in the round.');
    if (this.isProtected(owner)) throw new GameError("The knocker's cards are protected.");
    const card = this.cardAt(owner, slot);

    if (sameRank(card, top)) {
      this.player(owner).hand[slot] = null;
      this.forgetSlot(owner, slot);
      this.discard.push(card);
      this.topPaired = true;
      this.motion('match', { by: id, from: { owner, slot } });
      if (owner === id) {
        this.addLog(`${this.name(id)} matched their own ${cardLabel(card)}!`);
      } else {
        this.addLog(`${this.name(id)} matched ${this.name(owner)}'s ${cardLabel(card)}!`);
        if (this.player(id).hand.some(Boolean)) this.pendingGive.set(id, { to: owner, slot });
      }
      return true;
    }

    const penalty = this.drawCard();
    const whose = owner === id ? 'their' : `${this.name(owner)}'s`;
    if (penalty) {
      const at = this.placeInHand(this.player(id), penalty);
      this.motion('penalty', { by: id, tried: { owner, slot }, to: { owner: id, slot: at } });
      this.addLog(`${this.name(id)} tried to match ${whose} ${cardLabel(card)} — wrong! They draw a penalty card.`);
    } else {
      this.addLog(`${this.name(id)} tried to match ${whose} ${cardLabel(card)} — wrong! (No cards left to draw.)`);
    }
    return false;
  }

  /** After matching someone else's card, the matcher gives them one of their own. */
  give(id, slot) {
    const pending = this.pendingGive.get(id);
    if (!pending) throw new GameError('You do not owe anyone a card.');
    const me = this.player(id);
    const card = this.cardAt(id, slot);
    me.hand[slot] = null;
    this.forgetSlot(id, slot);
    this.pendingGive.delete(id);
    const target = this.player(pending.to);
    if (target && target.status === 'active') {
      let at = pending.slot;
      if (target.hand[at] === null) target.hand[at] = card;
      else at = this.placeInHand(target, card);
      this.motion('give', { from: { owner: id, slot }, to: { owner: target.id, slot: at } });
    } else {
      this.discard.unshift(card);
    }
    this.addLog(`${this.name(id)} gave a card to ${this.name(pending.to)}.`);
  }

  /** Skips a player's turn when they run out of time. A drawn card is discarded without its power. */
  forfeitTurn(id) {
    if (this.turnId !== id || !['turn', 'drawn', 'power'].includes(this.phase)) return;
    if (this.drawn) {
      this.motion('discardDrawn', { by: id });
      this.pushDiscard(this.drawn);
      this.addLog(`${this.name(id)} ran out of time and discarded ${cardLabel(this.drawn)}.`);
      this.drawn = null;
    } else {
      this.addLog(`${this.name(id)} ran out of time.`);
    }
    this.endTurn();
    this.version++;
  }

  /** Called by the server a moment after the knocker's cards are shown. */
  finishKnockReveal() {
    if (this.phase !== 'knockReveal') return;
    const first = this.player(this.firstKnocker());
    const knockers = this.knockers.map((kid) => this.player(kid));
    const totals = this.knockTotals;
    const busted = knockers.filter((k) => totals[k.id] > KNOCK_LIMIT);
    // If everyone still in knocked and all went over, nobody is left to play on: the lowest total wins.
    if (busted.length === knockers.length && this.activePlayers().every((p) => this.isProtected(p.id))) {
      this.knockers = [];
      this.knockTotals = null;
      this.addLog(`Everyone knocked and went over ${KNOCK_LIMIT}, so the lowest total wins.`);
      this.endRound();
      this.version++;
      return;
    }
    let anySafe = false;
    for (const k of knockers) {
      const total = totals[k.id];
      if (total > KNOCK_LIMIT) {
        k.status = 'out';
        this.discard.unshift(...k.hand.filter(Boolean)); // keep the top of the pile as it is
        k.hand = [];
        this.addLog(`${k.name} had ${total} — over ${KNOCK_LIMIT}, so they're out!`);
      } else {
        anySafe = true;
        this.addLog(`${k.name} had ${total}.`);
      }
    }
    this.knockers = [];
    this.knockTotals = null;
    if (anySafe) {
      this.addLog('Everyone reveals!');
      this.endRound();
    } else if (this.activePlayers().length === 1) {
      this.endRound();
    } else {
      this.addLog('Play continues until someone else knocks.');
      this.turnId = this.nextActiveAfterSeat(first.seat).id;
      this.phase = 'turn';
      this.turnNo++;
    }
    this.version++;
  }

  // ---------- internals ----------

  endTurn() {
    this.drawn = null;
    this.power = null;
    this.visible.delete(this.turnId);
    const next = this.nextActiveAfterSeat(this.player(this.turnId).seat);
    const first = this.firstKnocker();
    if (first && next.id === first) {
      this.knockTotals = Object.fromEntries(this.knockers.map((kid) => [kid, this.handTotal(kid)]));
      this.turnId = first;
      this.phase = 'knockReveal';
      const names = this.knockers.map((kid) => this.name(kid)).join(' and ');
      this.addLog(`Final turns are over. ${names} reveal${this.knockers.length > 1 ? '' : 's'} their cards…`);
      return;
    }
    this.turnId = next.id;
    this.phase = 'turn';
    this.turnNo++;
  }

  endRound() {
    this.phase = 'reveal';
    this.turnId = null;
    this.drawn = null;
    this.power = null;
    this.pendingGive.clear();
    this.visible.clear();
    const totals = {};
    for (const p of this.activePlayers()) totals[p.id] = this.handTotal(p.id);
    const best = Math.min(...Object.values(totals));
    const winners = Object.keys(totals).filter((id) => totals[id] === best);
    for (const id of winners) this.player(id).wins++;
    this.result = { winners, totals };
    const names = winners.map((id) => this.name(id)).join(' and ');
    this.addLog(`${names} win${winners.length > 1 ? '' : 's'} with ${best}!`);
  }

  nextActiveAfterSeat(seat) {
    const actives = this.activePlayers();
    return actives.find((p) => p.seat > seat) || actives[0];
  }

  requireTurn(id, phase) {
    if (this.phase !== phase || this.turnId !== id) {
      throw new GameError(this.turnId === id ? 'You cannot do that right now.' : "It's not your turn.");
    }
  }

  /** The card at a slot; throws if the slot is invalid or empty. */
  cardAt(owner, slot) {
    const p = this.player(owner);
    if (!p || !Number.isInteger(slot) || slot < 0 || slot >= p.hand.length || !p.hand[slot]) {
      throw new GameError('There is no card there.');
    }
    return p.hand[slot];
  }

  slotCard({ owner, slot }) {
    const p = this.player(owner);
    return (p && p.hand[slot]) || null;
  }

  /** Whether a power pick still points at the same card it did when it was made. */
  pickStillValid(pick) {
    const card = this.slotCard(pick);
    return !!card && card.id === pick.cardId;
  }

  swapSlots(a, b) {
    const pa = this.player(a.owner);
    const pb = this.player(b.owner);
    [pa.hand[a.slot], pb.hand[b.slot]] = [pb.hand[b.slot], pa.hand[a.slot]];
    this.forgetSlot(a.owner, a.slot);
    this.forgetSlot(b.owner, b.slot);
  }

  jokerShuffle(playedBy) {
    const spots = [];
    for (const p of this.activePlayers()) {
      if (p.id === playedBy || this.isProtected(p.id)) continue;
      p.hand.forEach((card, slot) => { if (card) spots.push({ p, slot, card }); });
    }
    const cards = shuffle(spots.map((s) => s.card), this.rng);
    spots.forEach((s, i) => {
      s.p.hand[s.slot] = cards[i];
      this.forgetSlot(s.p.id, s.slot);
    });
    this.motion('joker', { by: playedBy, spots: spots.map((s) => ({ owner: s.p.id, slot: s.slot })) });
  }

  /** Draws from the deck, reshuffling the discard pile (minus its top card) when the deck is empty. */
  drawCard() {
    if (this.deck.length === 0 && this.discard.length > 1) {
      const top = this.discard.pop();
      const second = this.topPaired ? this.discard.pop() : null;
      this.deck = shuffle(this.discard, this.rng);
      this.discard = second ? [second, top] : [top];
      this.addLog('The deck ran out. The discard pile was shuffled into a new deck.');
    }
    return this.deck.pop() || null;
  }

  pushDiscard(card) {
    this.discard.push(card);
    this.topPaired = false;
  }

  /** Puts a card in the first empty slot (or a new one) and returns the slot. */
  placeInHand(player, card) {
    const empty = player.hand.indexOf(null);
    if (empty >= 0) {
      player.hand[empty] = card;
      return empty;
    }
    player.hand.push(card);
    return player.hand.length - 1;
  }

  /** Records a public card movement for clients to animate. */
  motion(kind, data) {
    this.motions.push({ seq: ++this.motionSeq, kind, ...data });
    if (this.motions.length > 40) this.motions.shift();
  }

  see(viewer, owner, slot) {
    if (!this.visible.has(viewer)) this.visible.set(viewer, new Set());
    this.visible.get(viewer).add(`${owner}:${slot}`);
  }

  /** A card left this slot, so nobody's current peek applies to it any more. */
  forgetSlot(owner, slot) {
    for (const set of this.visible.values()) set.delete(`${owner}:${slot}`);
  }

  /** "one of their own cards", "two of their own cards", "Ray's card", "their own card and Ray's card", … */
  describePicks(id, picks) {
    const own = picks.filter((p) => p.owner === id).length;
    const others = picks.filter((p) => p.owner !== id).map((p) => `${this.name(p.owner)}'s card`);
    if (own === 2) return 'two of their own cards';
    if (others.length === 2 && others[0] === others[1]) return `two of ${this.name(picks[0].owner)}'s cards`;
    const parts = own ? ['one of their own cards', ...others] : others;
    return parts.join(' and ');
  }

  name(id) {
    const p = this.player(id);
    return p ? p.name : 'Someone';
  }

  addLog(text) {
    this.log.push({ t: Date.now(), text });
    if (this.log.length > 200) this.log.shift();
  }
}

module.exports = { Game, GameError, MAX_PLAYERS, KNOCK_LIMIT, INITIAL_PEEK_SLOTS, POWER_TEXT };
