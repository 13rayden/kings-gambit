'use strict';

/**
 * The four suits. Every King is drawn red, but only the "red" Kings (Triangle and
 * Spiral) are worth −1; the client marks those with a −1 badge.
 */
const SUITS = [
  { suit: 'triangle', red: true },
  { suit: 'circle', red: false },
  { suit: 'chip', red: false },
  { suit: 'spiral', red: true },
];
const SUIT_NAMES = { triangle: 'Triangles', circle: 'Circles', chip: 'Chips', spiral: 'Spirals' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A fresh, unshuffled 54-card deck: 52 cards plus a black and a red Joker. */
function makeDeck() {
  const deck = [];
  let id = 0;
  for (const { suit, red } of SUITS) {
    for (const rank of RANKS) deck.push({ id: id++, rank, suit, red });
  }
  deck.push({ id: id++, rank: 'JOKER', suit: null, red: false });
  deck.push({ id: id++, rank: 'JOKER', suit: null, red: true });
  return deck;
}

/** Fisher–Yates shuffle in place. */
function shuffle(cards, rng = Math.random) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

/** Points a card adds to a hand. A=1, 2–10 face value, J/Q/black K=10, red K=−1, Joker=0. */
function cardValue(card) {
  switch (card.rank) {
    case 'A': return 1;
    case 'J':
    case 'Q': return 10;
    case 'K': return card.red ? -1 : 10;
    case 'JOKER': return 0;
    default: return Number(card.rank);
  }
}

/** Matching compares rank only, so a red K matches a black K. */
function sameRank(a, b) {
  return a.rank === b.rank;
}

/** The power a card triggers when discarded straight from the deck, or null. */
function powerOf(card) {
  switch (card.rank) {
    case '7':
    case '8': return 'peekOwn';
    case '9':
    case '10': return 'peekOther';
    case 'J': return 'blindSwap';
    case 'Q': return 'peekTwo';
    case 'K': return 'king';
    case 'JOKER': return 'joker';
    default: return null;
  }
}

function cardLabel(card) {
  if (card.rank === 'JOKER') return 'Joker';
  return `${card.rank} of ${SUIT_NAMES[card.suit]}`;
}

module.exports = { makeDeck, shuffle, cardValue, sameRank, powerOf, cardLabel, RANKS };
