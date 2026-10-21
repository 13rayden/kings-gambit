'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError } = require('../server/engine/game');
const { card, seeded, setupGame } = require('./helpers');

const four = (...ranks) => ranks.map((r) => card(r));

test('start deals 4 cards each and shows only the bottom two', () => {
  const game = new Game({ rng: seeded(1) });
  game.addPlayer({ id: 'a', name: 'A', seat: 0 });
  game.addPlayer({ id: 'b', name: 'B', seat: 3 });
  game.start();
  assert.equal(game.phase, 'initialPeek');
  assert.equal(game.player('a').hand.length, 4);
  assert.equal(game.deck.length, 54 - 8);
  assert.ok(!game.canSee('a', 'a', 0));
  assert.ok(!game.canSee('a', 'a', 1));
  assert.ok(game.canSee('a', 'a', 2));
  assert.ok(game.canSee('a', 'a', 3));
  assert.ok(!game.canSee('a', 'b', 2));

  game.act('a', { type: 'ready' });
  assert.equal(game.phase, 'initialPeek');
  game.act('b', { type: 'ready' });
  assert.equal(game.phase, 'turn');
  assert.ok(!game.canSee('a', 'a', 2), 'cards flip back after the peek');
});

test('needs at least two players', () => {
  const game = new Game();
  game.addPlayer({ id: 'a', name: 'A', seat: 0 });
  assert.throws(() => game.start(), GameError);
});

test('draw and swap: drawn card goes into the hand, old card to the discard pile', () => {
  const drawn = card('2');
  const game = setupGame({ hands: { a: four('6', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [drawn] });
  game.act('a', { type: 'draw' });
  assert.equal(game.drawn, drawn);
  game.act('a', { type: 'swap', slot: 0 });
  assert.equal(game.player('a').hand[0], drawn);
  assert.equal(game.topDiscard().rank, '6');
  assert.equal(game.turnId, 'b');
  assert.equal(game.phase, 'turn');
});

test('the card you swap out uses its power', () => {
  const game = setupGame({ hands: { a: four('Q', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('2')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'swap', slot: 0 });
  assert.equal(game.topDiscard().rank, 'Q');
  assert.equal(game.phase, 'power');
  assert.equal(game.power.type, 'peekTwo');
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  assert.equal(game.canSee('a', 'a', 0) && game.player('a').hand[0].rank, '2', 'a can look at the card just swapped in');
  game.act('a', { type: 'done' });
  assert.equal(game.turnId, 'b');
});

test('a swapped-out Joker shuffles everyone else', () => {
  const aHand = [card('JOKER'), ...four('3', '4', '5')];
  const game = setupGame({ hands: { a: aHand, b: four('A', '2', '3', '4'), c: four('5', '6', '7', '8') }, deck: [card('2')], rng: seeded(5) });
  const others = [...game.player('b').hand, ...game.player('c').hand].map((c) => c.id).sort();
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'swap', slot: 0 });
  assert.equal(game.topDiscard().rank, 'JOKER');
  assert.deepEqual([...game.player('b').hand, ...game.player('c').hand].map((c) => c.id).sort(), others);
  assert.equal(game.player('a').hand[0].rank, '2', "the Joker player's own hand is untouched");
  assert.equal(game.turnId, 'b');
});

test('anyone, including the swapper, can match a swapped-out card', () => {
  const game = setupGame({ hands: { a: four('6', '6', '4', '5'), b: four('6', 'A', 'A', 'A') }, deck: [card('2')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'swap', slot: 0 }); // 6 on the pile, no power
  assert.ok(game.matchOpen());
  game.act('a', { type: 'match', owner: 'a', slot: 1 });
  assert.equal(game.player('a').hand[1], null);
  assert.throws(() => game.act('b', { type: 'match', owner: 'b', slot: 0 }), /triple/, 'b was too slow');
});

test('discarding a plain card ends the turn', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('6')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  assert.equal(game.topDiscard().rank, '6');
  assert.equal(game.turnId, 'b');
});

test('only the current player can draw', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('6')] });
  assert.throws(() => game.act('b', { type: 'draw' }), GameError);
});

test('7/8: look at one of your own cards', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('7')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  assert.equal(game.phase, 'power');
  assert.throws(() => game.act('a', { type: 'pick', owner: 'b', slot: 0 }), GameError);
  game.act('a', { type: 'pick', owner: 'a', slot: 1 });
  assert.ok(game.canSee('a', 'a', 1));
  assert.ok(!game.canSee('b', 'a', 1));
  game.act('a', { type: 'done' });
  assert.ok(!game.canSee('a', 'a', 1), 'the card flips back');
  assert.equal(game.turnId, 'b');
});

test("9/10: look at one of someone else's cards", () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('10')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  assert.throws(() => game.act('a', { type: 'pick', owner: 'a', slot: 0 }), GameError);
  game.act('a', { type: 'pick', owner: 'b', slot: 2 });
  assert.ok(game.canSee('a', 'b', 2));
  game.act('a', { type: 'done' });
  assert.equal(game.turnId, 'b');
});

test('J: blind swap one of yours with one of theirs', () => {
  const mine = card('Q');
  const theirs = card('A');
  const game = setupGame({ hands: { a: [mine, ...four('3', '4', '5')], b: [theirs, ...four('A', 'A', 'A')] }, deck: [card('J')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  assert.throws(() => game.act('a', { type: 'pick', owner: 'a', slot: 1 }), GameError, 'second pick must be theirs');
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  assert.equal(game.player('a').hand[0], theirs);
  assert.equal(game.player('b').hand[0], mine);
  assert.ok(!game.canSee('a', 'a', 0), 'blind swap shows nothing');
  assert.equal(game.turnId, 'b');
});

test('Q: look at any two cards', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('Q')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  assert.ok(!game.canSee('a', 'a', 0), 'nothing shows until both are picked');
  game.act('a', { type: 'pick', owner: 'b', slot: 3 });
  assert.ok(game.canSee('a', 'a', 0));
  assert.ok(game.canSee('a', 'b', 3));
  game.act('a', { type: 'done' });
  assert.equal(game.turnId, 'b');
});

test('K: look at two and swap them', () => {
  const mine = card('9');
  const theirs = card('2');
  const game = setupGame({ hands: { a: [mine, ...four('3', '4', '5')], b: [theirs, ...four('A', 'A', 'A')] }, deck: [card('K', 'chip')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  assert.equal(game.power.step, 'decide');
  assert.ok(game.canSee('a', 'b', 0));
  game.act('a', { type: 'kingSwap' });
  assert.equal(game.player('a').hand[0], theirs);
  assert.equal(game.player('b').hand[0], mine);
  assert.equal(game.turnId, 'b');
});

test('red K has the King power and can keep the cards', () => {
  const mine = card('9');
  const game = setupGame({ hands: { a: [mine, ...four('3', '4', '5')], b: four('A', 'A', 'A', 'A') }, deck: [card('K', 'triangle')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  assert.equal(game.power.type, 'king');
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  game.act('a', { type: 'kingKeep' });
  assert.equal(game.player('a').hand[0], mine);
});

test("Joker shuffles everyone's cards except the Joker player's and the knocker's", () => {
  const aHand = four('2', '3', '4', '5');
  const cHand = four('6', '7', '8', '9');
  const game = setupGame({
    hands: { a: aHand, b: four('A', 'A', 'A', 'A'), c: cHand, d: four('10', 'J', 'Q', 'K') },
    deck: [card('JOKER'), card('2')],
    rng: seeded(3),
  });
  // a knocks, b draws a Joker.
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'draw' });
  const bBefore = game.player('b').hand.slice();
  const pooled = [...cHand, ...game.player('d').hand].map((c) => c.id).sort();
  game.act('b', { type: 'discard' });
  assert.deepEqual(game.player('a').hand, aHand, 'knocker is protected');
  assert.deepEqual(game.player('b').hand, bBefore, 'Joker player keeps their cards');
  const after = [...game.player('c').hand, ...game.player('d').hand].map((c) => c.id).sort();
  assert.deepEqual(after, pooled, 'same cards, redistributed');
  assert.equal(game.player('c').hand.length, 4);
  assert.equal(game.player('d').hand.length, 4);
  assert.equal(game.turnId, 'c');
});

test('match your own card: the card goes onto the pile and leaves an empty slot', () => {
  const five = card('5', 'triangle');
  const game = setupGame({ hands: { a: four('2', '3', '4', 'A'), b: [five, ...four('A', 'A', 'A')] }, deck: [card('5')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  // b matches outside their turn? It's b's turn now; try during their 'turn' phase.
  game.act('b', { type: 'match', owner: 'b', slot: 0 });
  assert.equal(game.player('b').hand[0], null);
  assert.equal(game.topDiscard(), five);
  assert.ok(game.topPaired);
});

test('no triple stacking', () => {
  const game = setupGame({ hands: { a: four('5', '3', '4', 'A'), b: four('5', 'A', 'A', 'A') }, deck: [card('5')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  game.act('a', { type: 'match', owner: 'a', slot: 0 });
  assert.throws(() => game.act('b', { type: 'match', owner: 'b', slot: 0 }), /triple/);
  assert.equal(game.player('b').hand[0].rank, '5', 'no penalty for a blocked attempt');
});

test("match someone else's card, then give them one of yours", () => {
  const theirs = card('8');
  const gift = card('Q');
  const game = setupGame({ hands: { a: [gift, ...four('3', '4', 'A')], b: [theirs, ...four('A', 'A', 'A')], c: four('2', '2', '2', '2') }, deck: [card('8', 'triangle')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  // 8 has a power; a is choosing a card while c matches b's 8 out of turn.
  assert.equal(game.phase, 'power');
  game.act('c', { type: 'match', owner: 'b', slot: 0 });
  assert.equal(game.player('b').hand[0], null);
  assert.ok(game.pendingGive.has('c'));
  assert.throws(() => game.act('c', { type: 'match', owner: 'c', slot: 0 }), GameError);
  game.act('c', { type: 'give', slot: 1 });
  assert.equal(game.player('b').hand[0].rank, '2', 'the gift fills the empty slot');
  assert.equal(game.player('c').hand[1], null);
  assert.equal(game.phase, 'power', "a's turn carries on");
});

test('wrong match: the card stays and the matcher draws a penalty card', () => {
  const penalty = card('J');
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [penalty, card('6')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' }); // 6 on top
  game.act('b', { type: 'match', owner: 'a', slot: 0 }); // a's 2 ≠ 6
  assert.equal(game.player('a').hand[0].rank, '2');
  assert.equal(game.player('b').hand.length, 5);
  assert.equal(game.player('b').hand[4], penalty);
  assert.ok(!game.topPaired);
});

test('a penalty card fills an empty slot first', () => {
  const penalty = card('J');
  const game = setupGame({ hands: { a: [null, ...four('3', '4', '5')], b: four('A', 'A', 'A', 'A') }, deck: [penalty], discard: [card('9')] });
  game.act('a', { type: 'match', owner: 'a', slot: 1 });
  assert.equal(game.player('a').hand[0], penalty);
});

test("the knocker's cards can't be matched, and the knocker can't match", () => {
  const game = setupGame({ hands: { a: four('6', '3', '4', 'A'), b: four('6', 'A', 'A', 'A'), c: four('2', '2', '2', '2') }, deck: [card('6')] });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' }); // 6 on top
  assert.throws(() => game.act('c', { type: 'match', owner: 'a', slot: 0 }), /protected/);
  assert.throws(() => game.act('a', { type: 'match', owner: 'b', slot: 0 }), /frozen/);
});

test("J can't swap with the knocker", () => {
  const game = setupGame({ hands: { a: four('6', '3', '4', 'A'), b: four('6', 'A', 'A', 'A'), c: four('2', '2', '2', '2') }, deck: [card('J')] });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' });
  assert.throws(() => game.act('b', { type: 'pick', owner: 'a', slot: 0 }), /protected/);
});

test('empty deck: the discard pile (minus its top card) becomes the new deck', () => {
  const top = card('9');
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [], discard: [card('3'), card('4'), top] });
  game.act('a', { type: 'draw' });
  assert.ok(['3', '4'].includes(game.drawn.rank));
  assert.equal(game.deck.length, 1);
  assert.deepEqual(game.discard, [top]);
});

test('knock: everyone else gets one turn, then the lowest total wins', () => {
  const game = setupGame({
    hands: { a: four('A', '2', 'A', 'A'), b: [card('K', 'triangle'), card('JOKER'), card('A'), card('A')], c: four('9', '9', '9', '9') },
    deck: [card('6'), card('6')],
  });
  game.act('a', { type: 'knock' }); // a = 5
  assert.equal(game.turnId, 'b');
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' });
  assert.throws(() => game.act('b', { type: 'knock' }), GameError);
  game.act('c', { type: 'draw' });
  game.act('c', { type: 'discard' });
  assert.equal(game.phase, 'knockReveal');
  assert.ok(game.canSee('c', 'a', 0), "everyone sees the knocker's cards first");
  assert.ok(!game.canSee('c', 'b', 0), 'but not anyone else yet');
  game.finishKnockReveal();
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.result.totals, { a: 5, b: 1, c: 36 });
  assert.deepEqual(game.result.winners, ['b'], 'b (red K = -1, Joker = 0) beats the knocker');
});

test('knocker over 5 is out and play resumes until the next knock', () => {
  const game = setupGame({
    hands: { a: four('9', '9', 'A', 'A'), b: four('A', 'A', 'A', 'A'), c: four('2', '2', '2', '2') },
    deck: [card('6'), card('6'), card('6'), card('6'), card('6')],
  });
  game.act('a', { type: 'knock' }); // a = 20
  for (const id of ['b', 'c']) {
    game.act(id, { type: 'draw' });
    game.act(id, { type: 'discard' });
  }
  game.finishKnockReveal();
  assert.equal(game.player('a').status, 'out');
  assert.deepEqual(game.player('a').hand, []);
  assert.equal(game.phase, 'turn');
  assert.equal(game.turnId, 'b', 'play resumes from the seat after the knocker');
  assert.throws(() => game.act('a', { type: 'match', owner: 'b', slot: 0 }), GameError, 'out players cannot match');

  game.act('b', { type: 'knock' }); // b = 4
  game.act('c', { type: 'draw' });
  game.act('c', { type: 'discard' });
  assert.equal(game.phase, 'knockReveal');
  game.finishKnockReveal();
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.result.winners, ['b']);
  assert.ok(!('a' in game.result.totals));
});

test('a bust that leaves one player makes them the winner', () => {
  const game = setupGame({ hands: { a: four('9', '9', 'A', 'A'), b: four('Q', 'Q', 'Q', 'Q') }, deck: [card('6')] });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' });
  game.finishKnockReveal();
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.result.winners, ['b']);
});

test('ties share the win', () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', 'A'), b: four('A', 'A', 'A', 'A') }, deck: [card('6')] });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' });
  game.finishKnockReveal();
  assert.deepEqual(game.result.winners.sort(), ['a', 'b']);
});

test('new round resets everyone, including players who were out', () => {
  const game = setupGame({ hands: { a: four('9', '9', 'A', 'A'), b: four('A', 'A', 'A', 'A'), c: four('2', '2', '2', '2') }, deck: [card('6'), card('6')] });
  game.act('a', { type: 'knock' });
  for (const id of ['b', 'c']) {
    game.act(id, { type: 'draw' });
    game.act(id, { type: 'discard' });
  }
  game.finishKnockReveal(); // a is out
  game.act('b', { type: 'knock' });
  game.act('c', { type: 'draw' });
  game.act('c', { type: 'swap', slot: 0 }); // the reshuffled deck may hand c a power card
  game.finishKnockReveal();
  assert.equal(game.phase, 'reveal');
  game.start();
  assert.equal(game.phase, 'initialPeek');
  assert.equal(game.player('a').status, 'active');
  assert.equal(game.player('a').hand.length, 4);
});

test("knocking cancels cards owed to the knocker, whose hand is frozen", () => {
  const game = setupGame({ hands: { a: four('8', '3', '4', 'A'), b: four('Q', 'A', 'A', 'A'), c: four('2', '2', '2', '2') }, discard: [card('8', 'triangle')] });
  game.act('c', { type: 'match', owner: 'a', slot: 0 }); // c owes a a card
  assert.ok(game.pendingGive.has('c'));
  game.act('a', { type: 'knock' });
  assert.ok(!game.pendingGive.has('c'));
  assert.throws(() => game.act('c', { type: 'give', slot: 0 }), GameError);
  assert.equal(game.player('a').hand[0], null, "the knocker's hand didn't change");
});

test("you can't knock while you still owe a card", () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', 'A'), b: four('8', 'A', 'A', 'A') }, discard: [card('8', 'triangle')] });
  game.act('a', { type: 'match', owner: 'b', slot: 0 });
  assert.throws(() => game.act('a', { type: 'knock' }), /Give your card/);
  game.act('a', { type: 'give', slot: 1 });
  game.act('a', { type: 'knock' });
  assert.deepEqual(game.knockers, ['a']);
});

test('a power pick stops counting once that card is matched away', () => {
  const mine = card('9');
  const game = setupGame({ hands: { a: [mine, ...four('3', '4', '5')], b: four('A', 'A', 'A', 'A'), c: four('9', '2', '2', '2') }, deck: [card('J')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' }); // J on top
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  // Not a J, so this can't match — but simulate the picked card leaving: a matches it onto a 9.
  game.discard.push(card('9', 'spiral'));
  game.topPaired = false;
  game.act('a', { type: 'match', owner: 'a', slot: 0 });
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  assert.equal(game.phase, 'power', 'the swap waits for a new own pick instead of swapping an empty slot');
  assert.equal(game.power.picks.length, 1);
  game.act('a', { type: 'pick', owner: 'a', slot: 1 });
  assert.equal(game.turnId, 'b');
  assert.equal(game.player('b').hand[0].rank, '3');
});

test('a King cannot swap a card that moved after it was looked at', () => {
  const game = setupGame({ hands: { a: four('9', '3', '4', '5'), b: four('6', 'A', 'A', 'A'), c: four('2', '2', '2', '2') }, deck: [card('K')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  game.discard.push(card('6', 'spiral'));
  game.topPaired = false;
  game.act('c', { type: 'match', owner: 'b', slot: 0 });
  game.act('c', { type: 'give', slot: 0 }); // b's slot 0 now holds a different card
  assert.throws(() => game.act('a', { type: 'kingSwap' }), /moved/);
  game.act('a', { type: 'kingKeep' });
  assert.equal(game.turnId, 'b');
});

test('a timed-out turn discards the drawn card without its power', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('Q')] });
  game.act('a', { type: 'draw' });
  game.forfeitTurn('a');
  assert.equal(game.topDiscard().rank, 'Q');
  assert.equal(game.phase, 'turn');
  assert.equal(game.turnId, 'b');
});

// ---------- legalTargets / matchTargets: what each player may tap ----------

const slots = (targets) => targets.map((t) => `${t.owner}${t.slot}${t.kind ? `:${t.kind}` : ''}`).sort();
const atPower = (rank, hands, extra = {}) => {
  const game = setupGame({ hands, deck: [card(rank)], ...extra });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  return game;
};

test('legalTargets: nothing to tap on the turn start or on someone else\'s turn', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') }, deck: [card('6')] });
  assert.deepEqual(game.legalTargets('a'), []);
  game.act('a', { type: 'draw' });
  assert.deepEqual(game.legalTargets('b'), []);
  assert.deepEqual(game.legalTargets('nobody'), []);
});

test('legalTargets: with a drawn card, your own cards swap', () => {
  const game = setupGame({ hands: { a: [card('2'), null, card('4'), card('5')], b: four('A', 'A', 'A', 'A') }, deck: [card('6')] });
  game.act('a', { type: 'draw' });
  assert.deepEqual(slots(game.legalTargets('a')), ['a0:swap', 'a2:swap', 'a3:swap'], 'empty slots are not targets');
});

test('legalTargets: 7/8 picks your own cards, 9/10 picks anyone else\'s', () => {
  const hands = () => ({ a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A'), c: [card('6'), null, null, null] });
  assert.deepEqual(slots(atPower('7', hands()).legalTargets('a')), ['a0:pick', 'a1:pick', 'a2:pick', 'a3:pick']);
  assert.deepEqual(slots(atPower('10', hands()).legalTargets('a')), ['b0:pick', 'b1:pick', 'b2:pick', 'b3:pick', 'c0:pick']);
  assert.deepEqual(atPower('10', hands()).legalTargets('b'), [], 'only the power player picks');
});

test('legalTargets: J picks two cards from two different players, never a knocker\'s', () => {
  const game = atPower('J', { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A'), c: four('6', '6', '6', '6') });
  game.knockers = ['c'];
  assert.equal(game.legalTargets('a').length, 8, 'own and b, not the knocker c');
  assert.ok(game.legalTargets('a').every((t) => t.owner !== 'c'));
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  assert.deepEqual(slots(game.legalTargets('a')), ['b0:pick', 'b1:pick', 'b2:pick', 'b3:pick']);

  const other = atPower('J', { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') });
  other.act('a', { type: 'pick', owner: 'b', slot: 2 });
  assert.deepEqual(slots(other.legalTargets('a')), ['a0:pick', 'a1:pick', 'a2:pick', 'a3:pick']);

  const three = atPower('J', { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A'), c: four('6', '6', '6', '6') });
  three.act('a', { type: 'pick', owner: 'b', slot: 2 });
  assert.deepEqual(slots(three.legalTargets('a')), ['a0:pick', 'a1:pick', 'a2:pick', 'a3:pick', 'c0:pick', 'c1:pick', 'c2:pick', 'c3:pick'],
    'after one of b\'s cards: yours or c\'s, but not another of b\'s');
});

test('legalTargets: Q and K pick any card except one already picked', () => {
  for (const rank of ['Q', 'K']) {
    const game = atPower(rank, { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A') });
    assert.equal(game.legalTargets('a').length, 8);
    game.act('a', { type: 'pick', owner: 'b', slot: 1 });
    const targets = slots(game.legalTargets('a'));
    assert.equal(targets.length, 7);
    assert.ok(!targets.includes('b1:pick'));
    game.act('a', { type: 'pick', owner: 'a', slot: 0 });
    assert.deepEqual(game.legalTargets('a'), [], `${rank}: nothing to pick once two are picked`);
  }
});

test('legalTargets: a pick that was matched away frees its slot again', () => {
  const game = atPower('J', { a: four('9', '3', '4', '5'), b: four('6', 'A', 'A', 'A'), c: four('2', '2', '2', '2') });
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  game.discard.push(card('9', 'spiral'));
  game.topPaired = false;
  game.act('c', { type: 'match', owner: 'a', slot: 0 });
  game.act('c', { type: 'give', slot: 0 }); // a's slot 0 holds a new card, so the old pick is gone
  assert.ok(slots(game.legalTargets('a')).includes('a0:pick'));
  game.act('a', { type: 'pick', owner: 'a', slot: 0 });
  assert.equal(game.phase, 'power', 'the new own pick counts, and the J still needs one of theirs');
});

test('legalTargets: every listed pick is accepted by the engine, and nothing else is', () => {
  for (const rank of ['7', '9', 'J', 'Q', 'K']) {
    const hands = { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A'), c: four('6', '6', '6', '6') };
    const probe = atPower(rank, hands);
    probe.knockers = ['c'];
    const listed = new Set(slots(probe.legalTargets('a')));
    for (const owner of ['a', 'b', 'c']) {
      for (let slot = 0; slot < 4; slot++) {
        const game = atPower(rank, { a: four('2', '3', '4', '5'), b: four('A', 'A', 'A', 'A'), c: four('6', '6', '6', '6') });
        game.knockers = ['c'];
        let ok = true;
        try { game.act('a', { type: 'pick', owner, slot }); } catch (err) { if (!(err instanceof GameError)) throw err; ok = false; }
        assert.equal(ok, listed.has(`${owner}${slot}:pick`), `${rank} pick ${owner}${slot}`);
      }
    }
  }
});

test('legalTargets: owing a card makes your own cards give targets, even on your turn', () => {
  const game = setupGame({ hands: { a: four('9', '3', '4', '5'), b: four('6', 'A', 'A', 'A') }, deck: [card('2')], discard: [card('6', 'spiral')] });
  game.act('a', { type: 'match', owner: 'b', slot: 0 });
  game.act('a', { type: 'draw' });
  assert.deepEqual(slots(game.legalTargets('a')), ['a0:give', 'a1:give', 'a2:give', 'a3:give']);
  game.act('a', { type: 'give', slot: 1 });
  assert.deepEqual(slots(game.legalTargets('a')), ['a0:swap', 'a2:swap', 'a3:swap']);
});

test('matchTargets: any unprotected card, only while you may match', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: [card('6'), null, card('7'), card('8')], c: four('A', 'A', 'A', 'A') }, deck: [card('9')] });
  assert.deepEqual(game.matchTargets('a'), [], 'nothing on the discard pile yet');
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' });
  assert.equal(game.matchTargets('b').length, 11, 'empty slots are not targets');
  game.knockers = ['c'];
  assert.equal(game.matchTargets('b').length, 7, "the knocker's cards are protected");
  assert.deepEqual(game.matchTargets('c'), [], "the knocker can't match");
  game.topPaired = true;
  assert.deepEqual(game.matchTargets('b'), [], 'no triple stacking');
});

// ---------- Jack across any two players ----------

test("J can blind swap two other players' cards", () => {
  const b0 = card('9');
  const c0 = card('2');
  const game = atPower('J', { a: four('6', '3', '4', 'A'), b: [b0, ...four('A', 'A', 'A')], c: [c0, ...four('5', '5', '5')] });
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  assert.throws(() => game.act('a', { type: 'pick', owner: 'b', slot: 1 }), /different player/);
  game.act('a', { type: 'pick', owner: 'c', slot: 0 });
  assert.equal(game.player('b').hand[0], c0);
  assert.equal(game.player('c').hand[0], b0);
  assert.equal(game.turnId, 'b');
  assert.match(game.log[game.log.length - 1].text, /A blind-swapped B's card with C's card/);
});

test("J can't touch any knocker's cards", () => {
  const game = atPower('J', { a: four('6', '3', '4', 'A'), b: four('A', 'A', 'A', 'A'), c: four('5', '5', '5', '5'), d: four('7', '7', '7', '7') });
  game.knockers = ['b', 'c'];
  assert.throws(() => game.act('a', { type: 'pick', owner: 'b', slot: 0 }), /protected/);
  assert.throws(() => game.act('a', { type: 'pick', owner: 'c', slot: 0 }), /protected/);
  assert.deepEqual([...new Set(game.legalTargets('a').map((t) => t.owner))].sort(), ['a', 'd']);
});

// ---------- several knocks ----------

test('another player can knock during the final turns and is protected too', () => {
  const game = setupGame({
    hands: { a: four('A', 'A', 'A', '2'), b: four('A', '2', 'A', 'A'), c: four('9', '9', '9', '9') },
    deck: [card('6'), card('6')],
    discard: [card('A', 'chip')],
  });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'knock' }); // b knocks instead of taking their last turn
  assert.deepEqual(game.knockers, ['a', 'b']);
  assert.throws(() => game.act('c', { type: 'match', owner: 'b', slot: 0 }), /protected/);
  assert.throws(() => game.act('b', { type: 'match', owner: 'c', slot: 0 }), /frozen/);
  assert.equal(game.turnId, 'c');
  game.act('c', { type: 'draw' });
  game.act('c', { type: 'discard' });
  assert.equal(game.phase, 'knockReveal', 'final turns end back at the first knocker');
  assert.ok(game.canSee('c', 'a', 0) && game.canSee('c', 'b', 0), "every knocker's cards are shown");
  assert.ok(!game.canSee('a', 'c', 0));
  assert.deepEqual(game.knockTotals, { a: 5, b: 5 });
  game.finishKnockReveal();
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.result.winners.sort(), ['a', 'b'], 'the tie shares the win');
});

test("you can't knock twice", () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', '2'), b: four('9', '9', '9', '9') }, deck: [card('6')] });
  game.act('a', { type: 'knock' });
  game.knockers.push('b'); // pretend b knocked; a's turn can't come round again anyway
  game.turnId = 'a';
  game.phase = 'turn';
  assert.throws(() => game.act('a', { type: 'knock' }), /already knocked/);
});

test('when one knocker busts and another is safe, the bust is out and everyone else reveals', () => {
  const game = setupGame({
    hands: { a: four('A', 'A', 'A', 'A'), b: four('9', '9', '9', '9'), c: four('2', '2', '2', '2') },
    deck: [card('6')],
  });
  game.act('a', { type: 'knock' }); // 4
  game.act('b', { type: 'knock' }); // 36
  game.act('c', { type: 'draw' });
  game.act('c', { type: 'discard' });
  game.finishKnockReveal();
  assert.equal(game.player('b').status, 'out');
  assert.deepEqual(game.player('b').hand, []);
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.result.winners, ['a']);
  assert.ok(!('b' in game.result.totals));
});

test('when every knocker busts, play continues and the next knocker is protected', () => {
  const game = setupGame({
    hands: { a: four('9', '9', '9', '9'), b: four('8', '8', '8', '8'), c: four('A', 'A', 'A', 'A'), d: four('5', '5', '5', '5') },
    deck: [card('6'), card('6'), card('6'), card('6')],
  });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'knock' });
  for (const id of ['c', 'd']) {
    game.act(id, { type: 'draw' });
    game.act(id, { type: 'discard' });
  }
  game.finishKnockReveal();
  assert.equal(game.player('a').status, 'out');
  assert.equal(game.player('b').status, 'out');
  assert.equal(game.phase, 'turn');
  assert.equal(game.turnId, 'c', "play resumes after the first knocker's seat");
  assert.deepEqual(game.knockers, []);
  game.act('c', { type: 'knock' });
  assert.ok(game.isProtected('c'));
  game.act('d', { type: 'draw' });
  game.act('d', { type: 'discard' });
  assert.equal(game.phase, 'knockReveal');
  game.finishKnockReveal();
  assert.deepEqual(game.result.winners, ['c']);
});

// ---------- wins and who starts ----------

/** Plays a quick round: the given player knocks and everyone else discards a 6. */
function knockRound(game, knocker) {
  game.turnId = knocker;
  game.act(knocker, { type: 'knock' });
  while (game.phase !== 'knockReveal') {
    game.deck.push(card('6'));
    game.act(game.turnId, { type: 'draw' });
    game.act(game.turnId, { type: 'discard' });
  }
  game.finishKnockReveal();
}

test('every winner gets a win, ties included, and wins add up over rounds', () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', '2'), b: four('A', '2', 'A', 'A'), c: four('9', '9', '9', '9') } });
  assert.equal(game.player('a').wins, 0);
  knockRound(game, 'a');
  assert.deepEqual(game.result.winners.sort(), ['a', 'b']);
  assert.deepEqual(game.players.map((p) => p.wins), [1, 1, 0]);
  game.start();
  for (const [id, cards] of Object.entries({ a: four('9', '9', '9', '9'), b: four('A', 'A', 'A', 'A'), c: four('9', '9', '9', '9') })) game.player(id).hand = cards;
  game.finishInitialPeek();
  knockRound(game, 'b');
  assert.deepEqual(game.players.map((p) => p.wins), [1, 2, 0]);
});

test("the previous round's winner starts the next round; tied winners take turns", () => {
  const game = setupGame({ hands: { a: four('9', '9', '9', '9'), b: four('9', '9', '9', '9'), c: four('A', 'A', 'A', 'A') } });
  game.starterId = 'a';
  knockRound(game, 'c');
  game.start();
  assert.equal(game.turnId, 'c', 'the winner goes first');

  // A tie between a and c: the first of them clockwise after the last starter (c) is a.
  game.result = { winners: ['a', 'c'], totals: {} };
  game.phase = 'reveal';
  game.start();
  assert.equal(game.turnId, 'a');
  game.result = { winners: ['a', 'c'], totals: {} };
  game.phase = 'reveal';
  game.start();
  assert.equal(game.turnId, 'c');
});

test('the turn count restarts every round', () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', 'A'), b: four('9', '9', '9', '9') } });
  game.turnNo = 300;
  knockRound(game, 'a');
  game.start();
  game.finishInitialPeek();
  assert.equal(game.turnNo, 1);
});

test("a winner's count resets when they leave the table", () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', 'A'), b: four('9', '9', '9', '9') } });
  knockRound(game, 'a');
  assert.equal(game.player('a').wins, 1);
  game.removePlayer('a');
  game.addPlayer({ id: 'a', name: 'A', seat: 0 });
  assert.equal(game.player('a').wins, 0);
});

test('if everyone still in knocked and all went over 5, the lowest total wins instead of a stuck table', () => {
  const game = setupGame({ hands: { a: four('9', '9', '9', '9'), b: four('8', '8', '8', '8') } });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'knock' });
  assert.equal(game.phase, 'knockReveal');
  game.finishKnockReveal();
  assert.equal(game.phase, 'reveal');
  assert.deepEqual(game.result.winners, ['b']);
  assert.equal(game.player('b').wins, 1);
});
