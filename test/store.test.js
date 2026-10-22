'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../server/store');
const { Room, loadRoom, getRoom } = require('../server/rooms');

/** Just enough of a Redis client for the store: an in-memory key/value map. */
function fakeRedis() {
  const data = new Map();
  return {
    data,
    async set(key, value) { data.set(key, value); },
    async get(key) { return data.get(key) ?? null; },
    async del(key) { data.delete(key); },
  };
}

/** A socket stand-in: records what it was sent. */
const fakeSocket = () => ({ data: {}, sent: [], emit(event, payload) { this.sent.push([event, payload]); } });

test('a saved table comes back after a restart with its players, game and seats', async () => {
  const redis = fakeRedis();
  await store.connect(redis);

  const room = new Room('table1');
  const host = fakeSocket();
  room.attach(host, null);
  const token = room.sit(host, 0, 'Ray');
  room.addBot(host.data.playerId, 3);
  room.updateSettings(host.data.playerId, { handSize: 5, matchType: 'points', target: 3, turnSeconds: 30 });
  room.start(host.data.playerId);
  room.postChat(host.data.playerId, 'good luck');
  await store.flush();
  room.close();
  assert.ok(redis.data.has('kg:room:table1'));

  // "Restart": the table isn't in memory, so the first request loads it from what was saved.
  assert.equal(getRoom('table1'), null);
  const back = await loadRoom('table1');
  assert.equal(getRoom('table1'), back, 'later requests use the loaded copy');
  assert.equal(await loadRoom('nope'), null);
  assert.deepEqual(back.game.toJSON(), room.game.toJSON());
  assert.equal(back.hostId, room.hostId);
  assert.equal(back.game.settings.handSize, 5);
  assert.equal(back.turnMs, 30000);
  assert.ok(back.brains.has(room.game.players.find((p) => p.isBot).id), 'bots come back');
  assert.equal(back.chat.at(-1).text, 'good luck');

  // The player's browser reconnects with its saved token and gets its seat back.
  const again = fakeSocket();
  back.attach(again, token);
  assert.equal(again.data.playerId, host.data.playerId);
  const [, view] = again.sent.at(-1);
  assert.equal(view.me.id, host.data.playerId);
  assert.equal(view.seats[0].hand.length, 5);
  back.close();

  await store.remove('table1');
  assert.ok(!redis.data.has('kg:room:table1'));
});
