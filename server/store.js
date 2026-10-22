'use strict';

/* Saved tables. With REDIS_URL set (Render Key Value), every table is saved there
   shortly after each change and loaded again when the server starts, so tables
   survive redeploys, restarts and the free plan's sleep. Without REDIS_URL
   (local development) tables live in memory only, as before. */

const KEY_PREFIX = 'kg:room:';
const SAVE_DELAY_MS = 800;
const CONNECT_TIMEOUT_MS = 8000;
const TTL_SECONDS = 6 * 60 * 60; // the same as the idle-room cleanup

let client = null;
const pending = new Map(); // roomId -> { timer, room }

/** Connects to Redis if REDIS_URL is set. `override` lets tests pass a stand-in client. */
async function connect(override = null) {
  if (override) {
    client = override;
    return true;
  }
  const url = process.env.REDIS_URL;
  if (!url) return false;
  const { createClient } = require('redis');
  const c = createClient({ url });
  c.on('error', (err) => console.error('Saved tables (Redis):', err.message));
  // Never let a missing database stop the game from starting: give up after a few seconds.
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), CONNECT_TIMEOUT_MS); });
  try {
    await Promise.race([c.connect(), timeout]);
  } catch (err) {
    c.disconnect().catch(() => {});
    throw err;
  } finally {
    clearTimeout(timer);
  }
  client = c;
  return true;
}

const enabled = () => !!client;

async function write(room) {
  if (!client) return;
  try {
    await client.set(KEY_PREFIX + room.id, JSON.stringify(room.snapshot()), { EX: TTL_SECONDS });
  } catch (err) {
    console.error(`Could not save table ${room.id}:`, err.message);
  }
}

/** Saves a table soon; several changes in a burst become one write. */
function save(room) {
  if (!client) return;
  const entry = pending.get(room.id);
  if (entry) {
    entry.room = room;
    return;
  }
  const timer = setTimeout(() => {
    const { room: latest } = pending.get(room.id);
    pending.delete(room.id);
    write(latest);
  }, SAVE_DELAY_MS);
  timer.unref?.();
  pending.set(room.id, { timer, room });
}

async function remove(id) {
  const entry = pending.get(id);
  if (entry) clearTimeout(entry.timer);
  pending.delete(id);
  if (!client) return;
  try {
    await client.del(KEY_PREFIX + id);
  } catch (err) {
    console.error(`Could not delete table ${id}:`, err.message);
  }
}

/** Writes every table that is waiting to be saved, right now (used on shutdown). */
async function flush() {
  const rooms = [...pending.values()].map((e) => {
    clearTimeout(e.timer);
    return e.room;
  });
  pending.clear();
  await Promise.all(rooms.map(write));
}

/** One saved table's snapshot, or null. */
async function load(id) {
  if (!client) return null;
  const raw = await client.get(KEY_PREFIX + id);
  return raw ? JSON.parse(raw) : null;
}

module.exports = { connect, enabled, save, remove, flush, load };
