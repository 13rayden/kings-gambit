'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, GameError } = require('../server/engine/game');
const { BotBrain } = require('../server/bots');
const { seeded } = require('./helpers');

/** Plays a full round with only bots, the way the server drives them. Returns the step count. */
function playBotRound(seed, playerCount, handSize = 4) {
  const rng = seeded(seed);
  const game = new Game({ rng });
  const brains = [];
  for (let seat = 0; seat < playerCount; seat++) {
    game.addPlayer({ id: `bot${seat}`, name: `Bot ${seat}`, isBot: true, seat });
    brains.push(new BotBrain(`bot${seat}`, rng));
  }
  game.updateSettings({ handSize });
  game.start();
  let steps = 0;
  while (game.phase !== 'reveal') {
    if (++steps > 20000) throw new Error(`seed ${seed}: round never ended`);
    for (const b of brains) b.observe(game);
    if (game.phase === 'lastCall' && !brains.some((b) => b.reactiveAction(game))) {
      game.finishLastCall({ force: true });
      continue;
    }
    if (game.phase === 'knockReveal') {
      game.finishLastCall();
      game.finishKnockReveal();
      continue;
    }
    // Out-of-turn moves first, in a random order, like bots racing to match.
    let acted = false;
    for (const b of [...brains].sort(() => rng() - 0.5)) {
      const a = b.reactiveAction(game);
      if (a) {
        game.act(b.id, a);
        acted = true;
        break;
      }
    }
    if (acted) continue;
    const actors = game.phase === 'initialPeek' ? brains : brains.filter((b) => b.id === game.turnId);
    let moved = false;
    for (const b of actors) {
      const a = b.turnAction(game);
      if (!a) continue;
      try {
        game.act(b.id, a);
      } catch (err) {
        if (err instanceof GameError) throw new Error(`seed ${seed}: bot made an illegal move ${JSON.stringify(a)}: ${err.message}`);
        throw err;
      }
      moved = true;
      break;
    }
    if (!moved) throw new Error(`seed ${seed}: stuck in phase ${game.phase}`);
  }
  return { game, steps };
}

test('bots finish rounds with only legal moves (2–8 players, many seeds)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const players = 2 + (seed % 7);
    const { game } = playBotRound(seed, players);
    assert.equal(game.phase, 'reveal');
    assert.ok(game.result.winners.length >= 1);
    // Every card is still accounted for.
    const inHands = game.players.reduce((n, p) => n + p.hand.filter(Boolean).length, 0);
    assert.equal(inHands + game.deck.length + game.discard.length, 56, `seed ${seed}: cards went missing`);
  }
});

test("during someone's final turns a bot only knocks when it knows its hand is 5 or less", () => {
  const { BotBrain } = require('../server/bots');
  const { card: c, setupGame: setup } = require('./helpers');
  const game = setup({ hands: { a: [c('9'), c('9'), c('9'), c('9')], b: [c('A'), c('A'), c('A'), c('A')] } });
  game.act('a', { type: 'knock' });
  const brain = new BotBrain('b', () => 0.5);
  game.turnNo = 500; // late in a long round, when bots would normally take a risk
  assert.equal(brain.shouldKnock(game), false, "doesn't know its cards");
  for (let slot = 0; slot < 4; slot++) brain.memory.set(`b:${slot}`, game.player('b').hand[slot]);
  assert.equal(brain.shouldKnock(game), true, 'knows it has 4');
});

test('bots also finish 5- and 6-card rounds legally, even with 8 players and a small deck', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const handSize = seed % 2 ? 5 : 6;
    const players = 2 + (seed % 7);
    const { game } = playBotRound(seed, players, handSize);
    assert.equal(game.phase, 'reveal');
    const inHands = game.players.reduce((n, p) => n + p.hand.filter(Boolean).length, 0);
    assert.equal(inHands + game.deck.length + game.discard.length, 56, `seed ${seed}: cards went missing`);
  }
});
