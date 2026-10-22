'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDeck, cardValue, powerOf, sameRank, cardLabel } = require('../server/engine/cards');
const { card } = require('./helpers');

test('deck has 56 unique cards including four coloured jokers', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 56);
  assert.equal(new Set(deck.map((c) => c.id)).size, 56);
  const jokers = deck.filter((c) => c.rank === 'JOKER');
  assert.deepEqual(jokers.map((c) => c.color), ['purple', 'green', 'blue', 'gold']);
  assert.deepEqual(jokers.map(cardLabel), ['Purple Joker', 'Green Joker', 'Blue Joker', 'Gold Joker']);
  assert.ok(jokers.every((c) => cardValue(c) === 0));
});

test('card values', () => {
  assert.equal(cardValue(card('A')), 1);
  assert.equal(cardValue(card('7', 'triangle')), 7);
  assert.equal(cardValue(card('10')), 10);
  assert.equal(cardValue(card('J')), 10);
  assert.equal(cardValue(card('Q', 'spiral')), 10);
  assert.equal(cardValue(card('K', 'circle')), 10, 'black Kings are worth 10');
  assert.equal(cardValue(card('K', 'chip')), 10);
  assert.equal(cardValue(card('K', 'triangle')), -1);
  assert.equal(cardValue(card('K', 'spiral')), -1);
  assert.equal(cardValue(card('JOKER')), 0);
});

test('powers', () => {
  assert.equal(powerOf(card('6')), null);
  assert.equal(powerOf(card('7')), 'peekOwn');
  assert.equal(powerOf(card('8')), 'peekOwn');
  assert.equal(powerOf(card('9')), 'peekOther');
  assert.equal(powerOf(card('10')), 'peekOther');
  assert.equal(powerOf(card('J')), 'blindSwap');
  assert.equal(powerOf(card('Q')), 'peekTwo');
  assert.equal(powerOf(card('K', 'circle')), 'king');
  assert.equal(powerOf(card('K', 'triangle')), 'king');
  assert.equal(powerOf(card('JOKER')), 'joker');
});

test('red and black kings share a rank for matching', () => {
  assert.ok(sameRank(card('K', 'triangle'), card('K', 'circle')));
  assert.ok(!sameRank(card('Q'), card('K')));
  assert.ok(sameRank(card('JOKER', 'purple'), card('JOKER', 'gold')), 'any Joker matches any Joker');
});
