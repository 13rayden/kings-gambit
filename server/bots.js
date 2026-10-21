'use strict';

const { cardValue, sameRank } = require('./engine/cards');
const { KNOCK_LIMIT } = require('./engine/game');

const BOT_NAMES = ['Lucky', 'Maverick', 'Duchess', 'Bishop', 'Jester', 'Baron', 'Sprocket', 'Clover'];

/**
 * A bot only acts on what it has legitimately seen. It remembers cards it
 * peeked at, keyed by slot; a memory is dropped once that slot's card changes
 * (swaps, matches and Jokers are all announced at the table, so a human would
 * know too).
 */
class BotBrain {
  constructor(id, rng = Math.random) {
    this.id = id;
    this.rng = rng;
    this.memory = new Map(); // "owner:slot" -> card
    this.round = 0;
  }

  /** Records everything the bot can currently see. Call after every state change. */
  observe(game) {
    if (game.round !== this.round) {
      this.memory.clear();
      this.round = game.round;
    }
    for (const p of game.players) {
      p.hand.forEach((card, slot) => {
        if (card && game.canSee(this.id, p.id, slot)) this.memory.set(`${p.id}:${slot}`, card);
      });
    }
  }

  /** The remembered card at a slot, if it is still the same card. */
  known(game, owner, slot) {
    const key = `${owner}:${slot}`;
    const remembered = this.memory.get(key);
    const p = game.player(owner);
    const actual = p && p.hand[slot];
    if (remembered && actual && actual.id === remembered.id) return remembered;
    if (remembered) this.memory.delete(key);
    return null;
  }

  ownSlots(game) {
    const me = game.player(this.id);
    return me.hand
      .map((card, slot) => (card ? { slot, known: this.known(game, this.id, slot) } : null))
      .filter(Boolean);
  }

  otherSlots(game, { allowProtected = true } = {}) {
    const out = [];
    for (const p of game.activePlayers()) {
      if (p.id === this.id || (!allowProtected && game.isProtected(p.id))) continue;
      p.hand.forEach((card, slot) => {
        if (card) out.push({ owner: p.id, slot, known: this.known(game, p.id, slot) });
      });
    }
    return out;
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  /** The bot's move when it is its turn (or the opening peek), or null. */
  turnAction(game) {
    if (!game.isActive(this.id)) return null;
    if (game.phase === 'initialPeek') return game.ready.has(this.id) ? null : { type: 'ready' };
    if (game.turnId !== this.id) return null;

    if (game.phase === 'turn') return this.shouldKnock(game) ? { type: 'knock' } : { type: 'draw' };
    if (game.phase === 'drawn') return this.drawnAction(game);
    if (game.phase === 'power') return this.powerAction(game);
    return null;
  }

  shouldKnock(game) {
    if (game.isProtected(this.id)) return false;
    const own = this.ownSlots(game);
    const unknown = own.filter((s) => !s.known).length;
    const knownTotal = own.reduce((sum, s) => sum + (s.known ? cardValue(s.known) : 0), 0);
    // During someone else's final turns, only knock with a hand the bot is sure of.
    if (game.knockers.length) return unknown === 0 && knownTotal <= KNOCK_LIMIT;
    if (unknown === 0) return knownTotal <= KNOCK_LIMIT;
    // A long round: take a calculated risk, assuming unknown cards are about average.
    if (game.turnNo > 40 && knownTotal + unknown * 4 <= KNOCK_LIMIT) return true;
    return game.turnNo > 120;
  }

  drawnAction(game) {
    const drawn = game.drawn;
    const v = cardValue(drawn);
    const own = this.ownSlots(game);
    const known = own.filter((s) => s.known);
    // Discard it if we can then match one of our own cards onto it.
    if (known.some((s) => sameRank(s.known, drawn))) return { type: 'discard' };
    const worst = known.sort((a, b) => cardValue(b.known) - cardValue(a.known))[0];
    let slot = null;
    if (worst && cardValue(worst.known) > v) slot = worst.slot;
    else if (v <= 4) {
      const unknown = own.filter((s) => !s.known);
      if (unknown.length) slot = this.pick(unknown).slot;
    }
    if (slot === null) return { type: 'discard' };
    this.memory.set(`${this.id}:${slot}`, drawn); // we know what we put there
    return { type: 'swap', slot };
  }

  powerAction(game) {
    const power = game.power;
    if (power.step === 'viewing') return { type: 'done' };
    if (power.step === 'decide') {
      const [a, b] = power.picks;
      const ca = this.known(game, a.owner, a.slot);
      const cb = this.known(game, b.owner, b.slot);
      if (!ca || !cb || game.isProtected(a.owner) || game.isProtected(b.owner)) return { type: 'kingKeep' };
      const mineFirst = a.owner === this.id;
      const mine = mineFirst ? ca : cb;
      const theirs = mineFirst ? cb : ca;
      return cardValue(theirs) < cardValue(mine) ? { type: 'kingSwap' } : { type: 'kingKeep' };
    }

    const own = this.ownSlots(game).filter((s) => !power.picks.some((p) => p.owner === this.id && p.slot === s.slot));
    const ownUnknown = own.filter((s) => !s.known);
    const others = this.otherSlots(game).filter((s) => !power.picks.some((p) => p.owner === s.owner && p.slot === s.slot));
    const othersUnknown = others.filter((s) => !s.known);
    const asPick = (owner, s) => ({ type: 'pick', owner, slot: s.slot });

    switch (power.type) {
      case 'peekOwn': {
        const s = ownUnknown.length ? this.pick(ownUnknown) : own.length ? this.pick(own) : null;
        return s ? asPick(this.id, s) : { type: 'skip' };
      }
      case 'peekOther': {
        const s = othersUnknown.length ? this.pick(othersUnknown) : others.length ? this.pick(others) : null;
        return s ? asPick(s.owner, s) : { type: 'skip' };
      }
      case 'peekTwo': {
        if (ownUnknown.length) return asPick(this.id, this.pick(ownUnknown));
        const s = othersUnknown.length ? this.pick(othersUnknown) : others.length ? this.pick(others) : null;
        return s ? asPick(s.owner, s) : { type: 'skip' };
      }
      case 'king': {
        if (power.picks.length === 0) {
          const worst = this.worstKnown(own);
          const s = worst && cardValue(worst.known) >= 6 ? worst : ownUnknown.length ? this.pick(ownUnknown) : worst;
          return s ? asPick(this.id, s) : { type: 'skip' };
        }
        const swappable = others.filter((s) => !game.isProtected(s.owner));
        const s = swappable.find((x) => x.known && cardValue(x.known) <= 2) || (swappable.length ? this.pick(swappable) : null);
        return s ? asPick(s.owner, s) : { type: 'skip' };
      }
      case 'blindSwap': {
        const swappable = others.filter((s) => !game.isProtected(s.owner));
        if (power.picks.length === 0) {
          const worst = this.worstKnown(own);
          if (!worst || cardValue(worst.known) < 7 || !swappable.length) return { type: 'skip' };
          return asPick(this.id, worst);
        }
        const target = swappable
          .filter((x) => x.known)
          .sort((a, b) => cardValue(a.known) - cardValue(b.known))[0] || (swappable.length ? this.pick(swappable) : null);
        return target ? asPick(target.owner, target) : { type: 'skip' };
      }
      default:
        return { type: 'skip' };
    }
  }

  worstKnown(slots) {
    return slots.filter((s) => s.known).sort((a, b) => cardValue(b.known) - cardValue(a.known))[0] || null;
  }

  /** Out-of-turn moves: giving a card after a match, or matching a card it knows. */
  reactiveAction(game) {
    if (!game.isActive(this.id) || game.isProtected(this.id)) return null;
    if (game.pendingGive.has(this.id)) {
      const own = this.ownSlots(game);
      if (!own.length) return null;
      const worst = this.worstKnown(own);
      const unknown = own.filter((s) => !s.known);
      const s = worst && cardValue(worst.known) >= 5 ? worst : unknown.length ? this.pick(unknown) : worst || own[0];
      return { type: 'give', slot: s.slot };
    }
    if (!game.matchOpen()) return null;
    const top = game.topDiscard();
    const mine = this.ownSlots(game).find((s) => s.known && sameRank(s.known, top) && cardValue(s.known) > 0);
    if (mine) return { type: 'match', owner: this.id, slot: mine.slot };
    // Taking someone else's card means giving one back, so only do it with a card worth getting rid of.
    const own = this.ownSlots(game);
    const worst = this.worstKnown(own);
    if (own.length && worst && cardValue(worst.known) >= 5) {
      const theirs = this.otherSlots(game, { allowProtected: false }).find(
        (s) => s.known && sameRank(s.known, top) && cardValue(s.known) >= 0,
      );
      if (theirs) return { type: 'match', owner: theirs.owner, slot: theirs.slot };
    }
    return null;
  }
}

module.exports = { BotBrain, BOT_NAMES };
