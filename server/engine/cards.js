'use strict';

/** The four suits. Every King, in any suit, is a red King worth −1. */
const SUITS = ['triangle', 'circle', 'chip', 'spiral'];
const SUIT_NAMES = { triangle: 'Triangles', circle: 'Circles', chip: 'Chips', spiral: 'Spirals' };
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/** A fresh, unshuffled 54-card deck: 52 cards plus two Jokers. */
function makeDeck() {
  const deck = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ id: id++, rank, suit });
  }
  deck.push({ id: id++, rank: 'JOKER', suit: null });
  deck.push({ id: id++, rank: 'JOKER', suit: null });
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

/** Points a card adds to a hand. A=1, 2–10 face value, J/Q=10, K (all red)=−1, Joker=0. */
function cardValue(card) {
  switch (card.rank) {
    case 'A': return 1;
    case 'J':
    case 'Q': return 10;
    case 'K': return -1;
    case 'JOKER': return 0;
    default: return Number(card.rank);
  }
}

/** Matching compares rank only, so any K matches any other K. */
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
