'use strict';

const { Game } = require('../server/engine/game');

let nextId = 1000;

/** A test card, e.g. card('K', 'spiral'). Triangle and Spiral are the red suits (their Kings are −1). */
function card(rank, suit = 'circle') {
  const red = rank !== 'JOKER' && (suit === 'triangle' || suit === 'spiral');
  return { id: nextId++, rank, suit: rank === 'JOKER' ? null : suit, red };
}

/** Deterministic RNG so shuffles are repeatable. */
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A game already past the opening peek, with the given hands.
 * hands: { a: [cards], b: [cards], ... } in seat order. deck: cards drawn from the end.
 */
function setupGame({ hands, deck = [], discard = [], rng = seeded(7) }) {
  const game = new Game({ rng });
  Object.keys(hands).forEach((id, seat) => game.addPlayer({ id, name: id.toUpperCase(), seat }));
  game.start();
  for (const [id, cards] of Object.entries(hands)) game.player(id).hand = cards.slice();
  game.deck = deck.slice();
  game.discard = discard.slice();
  game.topPaired = false;
  game.turnId = Object.keys(hands)[0];
  game.finishInitialPeek();
  return game;
}

module.exports = { card, seeded, setupGame };
