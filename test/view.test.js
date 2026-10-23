'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildView } = require('../server/view');
const { card, setupGame } = require('./helpers');

const four = (...ranks) => ranks.map((r) => card(r));
const fakeRoom = (game) => ({ id: 'r1', game, hostId: 'a', turnDeadline: null, isConnected: () => true, feed: () => [] });

test("a player's view never contains hidden cards or card ids", () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('9', '10', 'J', 'Q') }, deck: [card('7')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' }); // 7: look at own card
  game.act('a', { type: 'pick', owner: 'a', slot: 1 });

  const viewA = buildView(fakeRoom(game), 'a');
  assert.deepEqual(viewA.seats[0].hand[1], { rank: '3', suit: 'circle', red: false, value: 3, label: '3 of Circles' });
  assert.deepEqual(viewA.seats[0].hand[0], { hidden: true });
  assert.deepEqual(viewA.seats[1].hand, [{ hidden: true }, { hidden: true }, { hidden: true }, { hidden: true }]);

  const viewB = buildView(fakeRoom(game), 'b');
  assert.deepEqual(viewB.seats[0].hand[1], { hidden: true }, "b can't see a's peek");
  const json = JSON.stringify(viewB);
  assert.ok(!json.includes('"id":1'), 'no card ids in the payload');
  for (const rank of ['"9"', '"10"', '"J"', '"Q"', '"2"', '"3"', '"4"', '"5"']) {
    assert.ok(!json.includes(`"rank":${rank}`), `rank ${rank} leaked to b`);
  }
});

test("only the current player sees the drawn card", () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('9', '10', 'J', 'Q') }, deck: [card('6')] });
  game.act('a', { type: 'draw' });
  assert.equal(buildView(fakeRoom(game), 'a').drawn.rank, '6');
  assert.deepEqual(buildView(fakeRoom(game), 'b').drawn, { hidden: true });
  assert.deepEqual(buildView(fakeRoom(game), null).drawn, { hidden: true }, 'spectators too');
});

test('everything is face up at the reveal', () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', 'A'), b: four('9', '10', 'J', 'Q') }, deck: [card('6')] });
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' });
  game.finishLastCall();
  game.finishKnockReveal();
  const view = buildView(fakeRoom(game), 'a');
  assert.equal(view.seats[1].hand[3].rank, 'Q');
  assert.equal(view.seats[0].total, 4);
});

test('the view lists what this viewer may tap, and only for them', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('9', '10', 'J', 'Q') }, deck: [card('J')] });
  game.act('a', { type: 'draw' });
  const drawnA = buildView(fakeRoom(game), 'a');
  assert.equal(drawnA.drawnPower, 'blind swap');
  assert.deepEqual(drawnA.targets.map((t) => t.kind), ['swap', 'swap', 'swap', 'swap']);
  const drawnB = buildView(fakeRoom(game), 'b');
  assert.equal(drawnB.drawnPower, null, "b can't learn what a drew from its power");
  assert.deepEqual(drawnB.targets, []);

  game.act('a', { type: 'discard' });
  const viewA = buildView(fakeRoom(game), 'a');
  assert.equal(viewA.power.title, 'Jack — blind swap');
  assert.match(viewA.power.help, /swap them without looking/);
  assert.equal(viewA.targets.length, 8);
  assert.equal(viewA.matchTargets.length, 8, 'the J on the pile can be matched');
  assert.deepEqual(buildView(fakeRoom(game), null).targets, [], 'spectators tap nothing');
  assert.deepEqual(buildView(fakeRoom(game), null).matchTargets, []);
});

test('motions describe public moves by position only', () => {
  const game = setupGame({
    hands: { a: four('9', '3', '4', '5'), b: four('8', '10', 'J', 'Q') },
    deck: [card('2'), card('Q'), card('6')],
  });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'swap', slot: 1 }); // 3 out, no power
  game.act('b', { type: 'draw' }); // Q
  game.act('b', { type: 'discard' });
  game.act('b', { type: 'pick', owner: 'a', slot: 0 });
  game.act('b', { type: 'pick', owner: 'b', slot: 3 });
  game.act('b', { type: 'done' });
  game.act('b', { type: 'match', owner: 'b', slot: 3 }); // Q onto Q
  const kinds = game.motions.map((m) => m.kind);
  assert.deepEqual(kinds.slice(-6), ['draw', 'swapIn', 'draw', 'discardDrawn', 'look', 'match']);
  const look = game.motions.find((m) => m.kind === 'look');
  assert.deepEqual(look.cards, [{ owner: 'a', slot: 0 }, { owner: 'b', slot: 3 }]);
  const json = JSON.stringify(buildView(fakeRoom(game), 'a').motions);
  assert.ok(!/"(id|cardId|rank|suit)"/.test(json), 'motions carry no card identity');
  const seqs = game.motions.map((m) => m.seq);
  assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
});

test('penalty and give motions say where the card landed', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('8', 'A', 'A', 'A') }, deck: [card('J'), card('8')], discard: [card('8', 'triangle')] });
  game.act('a', { type: 'match', owner: 'b', slot: 0 });
  game.act('a', { type: 'give', slot: 2 });
  assert.deepEqual(game.motions.at(-1), { seq: game.motionSeq, kind: 'give', from: { owner: 'a', slot: 2 }, to: { owner: 'b', slot: 0 } });
  game.act('a', { type: 'draw' }); // 8 drawn
  game.act('a', { type: 'discard' }); // 8 on top
  game.act('b', { type: 'match', owner: 'a', slot: 0 }); // a's 2 — wrong
  assert.deepEqual(game.motions.at(-1).to, { owner: 'b', slot: 4 });
});

test('targets carry only owner, slot and kind: never card ids or faces', () => {
  const game = setupGame({ hands: { a: four('2', '3', '4', '5'), b: four('9', '10', 'J', 'Q') }, deck: [card('K')], discard: [card('9', 'spiral')] });
  game.act('a', { type: 'draw' });
  game.act('a', { type: 'discard' }); // K power
  game.act('a', { type: 'pick', owner: 'b', slot: 0 });
  for (const viewer of ['a', 'b', null]) {
    const view = buildView(fakeRoom(game), viewer);
    for (const t of [...view.targets, ...view.matchTargets]) {
      assert.deepEqual(Object.keys(t).filter((k) => !['owner', 'slot', 'kind'].includes(k)), []);
    }
    for (const p of view.power.picks) assert.deepEqual(Object.keys(p).sort(), ['owner', 'slot'], 'pick card ids stay on the server');
    const json = JSON.stringify(view);
    assert.ok(!/"(id|cardId)":\d/.test(json), `no card ids for ${viewer}`);
    // One of the King's two picks is made, so nothing has been looked at yet: only the K on the pile shows.
    for (const rank of ['"9"', '"10"', '"J"', '"Q"', '"2"', '"3"', '"4"', '"5"']) {
      assert.ok(!json.includes(`"rank":${rank}`), `rank ${rank} leaked to ${viewer}`);
    }
  }
});

test('the view shows every knocker, their reveal totals and each seat\'s wins, but no hidden cards', () => {
  const game = setupGame({ hands: { a: four('A', 'A', 'A', '2'), b: four('A', '2', 'A', 'A'), c: four('9', '10', 'J', 'Q') }, deck: [card('6')] });
  game.player('c').wins = 3;
  game.act('a', { type: 'knock' });
  game.act('b', { type: 'knock' });
  const during = buildView(fakeRoom(game), 'c');
  assert.deepEqual(during.knockers, ['a', 'b']);
  assert.deepEqual(during.seats.slice(0, 3).map((s) => s.knocked), [true, true, false]);
  assert.deepEqual(during.seats.slice(0, 3).map((s) => s.wins), [0, 0, 3]);
  game.act('c', { type: 'draw' });
  game.act('c', { type: 'discard' });
  const lastCall = buildView(fakeRoom(game), 'c');
  assert.equal(lastCall.phase, 'lastCall');
  assert.ok(lastCall.seats[0].hand.every((x) => x.hidden), "the knockers' cards stay hidden during the last chance to match");
  assert.ok(lastCall.matchTargets.length > 0, 'c may still match');
  game.finishLastCall();
  const reveal = buildView(fakeRoom(game), 'c');
  assert.deepEqual(reveal.seats.slice(0, 3).map((s) => s.knockTotal), [5, 5, null]);
  assert.equal(reveal.seats[0].hand[0].rank, 'A', "knockers' cards are face up");
  const json = JSON.stringify(buildView(fakeRoom(game), 'a'));
  for (const rank of ['"9"', '"10"', '"J"', '"Q"']) assert.ok(!json.includes(`"rank":${rank}`), `c's ${rank} stays hidden`);
});

test('5- and 6-card hands stay hidden, and the view carries settings, points and the match ranking', () => {
  for (const handSize of [5, 6]) {
    const game = new (require('../server/engine/game').Game)({ rng: require('./helpers').seeded(5) });
    game.addPlayer({ id: 'a', name: 'A', seat: 0 });
    game.addPlayer({ id: 'b', name: 'B', seat: 1 });
    game.updateSettings({ handSize, matchType: 'points', target: 1 });
    game.start();
    const view = buildView(fakeRoom(game), 'a');
    assert.equal(view.seats[0].hand.length, handSize);
    assert.equal(view.seats[0].hand.filter((c) => !c.hidden).length, 2, 'only your bottom two');
    assert.ok(view.seats[1].hand.every((c) => c.hidden), "nothing of b's");
    assert.ok(!/"(id|cardId)":\d/.test(JSON.stringify(view)), 'no card ids');
    assert.deepEqual(view.settings, { handSize, matchType: 'points', target: 1, turnSeconds: 45 });
    assert.equal(view.match.inProgress, true);
  }
  const game = setupGame({ hands: { a: four('A', 'A', 'A', 'A'), b: four('9', '9', '9', '9') } });
  game.settings.target = 1;
  game.act('a', { type: 'knock' });
  game.deck.push(card('6'));
  game.act('b', { type: 'draw' });
  game.act('b', { type: 'discard' });
  game.finishLastCall();
  game.finishKnockReveal();
  const view = buildView(fakeRoom(game), 'b');
  assert.equal(view.match.over, true);
  assert.deepEqual(view.match.ranking.map((r) => [r.id, r.place]), [['a', 1], ['b', 2]]);
  assert.deepEqual(view.seats.slice(0, 2).map((s) => s.points), [4, 36]);
});
