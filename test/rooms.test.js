'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Room } = require('../server/rooms');
const { card, setupGame } = require('./helpers');

const four = (...ranks) => ranks.map((r) => card(r));

test("the last chance waits for an owed card, but goes ahead after 15 more seconds", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = new Room('r1');
  // Human players only, so no bot gives the card back.
  room.game = setupGame({
    hands: { a: four('A', 'A', 'A', '2'), b: four('5', '5', '5', '5'), c: [card('9'), ...four('3', '3', '3')] },
    deck: [card('6'), card('6')],
  });
  const game = room.game;
  game.act('a', { type: 'knock' });
  for (const id of ['b', 'c']) { game.act(id, { type: 'draw' }); game.act(id, { type: 'discard' }); }
  assert.equal(game.phase, 'lastCall');
  game.discard.push(card('9', 'spiral'));
  game.topPaired = false;
  game.act('b', { type: 'match', owner: 'c', slot: 0 }); // b now owes c a card
  room.changed();

  t.mock.timers.tick(5000);
  assert.equal(game.phase, 'lastCall', 'waits for the give after the 5 seconds');
  t.mock.timers.tick(5000);
  t.mock.timers.tick(5000);
  assert.equal(game.phase, 'lastCall', 'still waiting');
  t.mock.timers.tick(5000);
  assert.equal(game.phase, 'knockReveal', 'after 15 more seconds the reveal goes ahead');
  assert.equal(game.pendingGive.size, 0);
  room.close();
});

test('the last chance ends after 5 seconds when nobody owes a card', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const room = new Room('r2');
  room.game = setupGame({ hands: { a: four('A', 'A', 'A', '2'), b: four('5', '5', '5', '5') }, deck: [card('6')] });
  room.game.act('a', { type: 'knock' });
  room.game.act('b', { type: 'draw' });
  room.game.act('b', { type: 'discard' });
  room.changed();
  assert.equal(room.game.phase, 'lastCall');
  t.mock.timers.tick(4900);
  assert.equal(room.game.phase, 'lastCall');
  t.mock.timers.tick(200);
  assert.equal(room.game.phase, 'knockReveal');
  room.close();
});
