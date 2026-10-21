'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDeck, cardValue, powerOf, sameRank } = require('../server/engine/cards');
const { card } = require('./helpers');

test('deck has 54 unique cards including two jokers', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 54);
  assert.equal(new Set(deck.map((c) => c.id)).size, 54);
  assert.equal(deck.filter((c) => c.rank === 'JOKER').length, 2);
});

test('card values', () => {
  assert.equal(cardValue(card('A')), 1);
  assert.equal(cardValue(card('7', 'triangle')), 7);
  assert.equal(cardValue(card('10')), 10);
  assert.equal(cardValue(card('J')), 10);
  assert.equal(cardValue(card('Q', 'spiral')), 10);
  assert.equal(cardValue(card('K', 'circle')), -1, 'every King is red and worth −1');
  assert.equal(cardValue(card('K', 'chip')), -1);
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
});
