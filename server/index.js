'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { GameError } = require('./engine/game');
const { createRoom, getRoom, loadRoom } = require('./rooms');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.static(PUBLIC));

// Render pings this to know the server is up.
app.get('/healthz', (req, res) => res.send('ok'));

app.post('/api/tables', (req, res) => {
  const room = createRoom();
  res.json({ id: room.id, url: `/t/${room.id}` });
});

app.get('/t/:id', async (req, res) => {
  if (!(await loadRoom(req.params.id))) return res.redirect('/?missing=1');
  res.sendFile(path.join(PUBLIC, 'table.html'));
});

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  const room = () => {
    const r = getRoom(socket.data.roomId);
    if (!r) throw new GameError('Join a table first.');
    return r;
  };

  /** Runs a handler and reports rule violations back to just this player. */
  const handle = (fn) => (payload = {}, ack) => {
    try {
      const result = fn(payload);
      if (typeof ack === 'function') ack({ ok: true, ...result });
    } catch (err) {
      if (!(err instanceof GameError)) console.error(err);
      const message = err instanceof GameError ? err.message : 'Something went wrong.';
      if (typeof ack === 'function') ack({ ok: false, error: message });
      else socket.emit('problem', message);
    }
  };

  // Joining may need to load a saved table first (after a restart), so it is the one async handler.
  socket.on('join', async ({ roomId, token } = {}, ack) => {
    const r = await loadRoom(String(roomId));
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!r) return reply({ ok: false, error: 'This table no longer exists.' });
    r.attach(socket, token);
    return reply({ ok: true });
  });

  socket.on('sit', handle(({ seat, name }) => ({ token: room().sit(socket, seat, name) })));
  socket.on('leave', handle(() => room().leave(socket)));
  socket.on('addBot', handle(({ seat }) => room().addBot(socket.data.playerId, seat)));
  socket.on('fillBots', handle(() => room().fillWithBots(socket.data.playerId)));
  socket.on('removeSeat', handle(({ seat }) => room().removeSeat(socket.data.playerId, seat)));
  socket.on('start', handle(() => room().start(socket.data.playerId)));
  socket.on('settings', handle((patch) => room().updateSettings(socket.data.playerId, patch)));
  socket.on('act', handle((action) => room().act(socket.data.playerId, action)));
  socket.on('chat', handle(({ text }) => room().postChat(socket.data.playerId, text)));

  socket.on('disconnect', () => {
    const r = getRoom(socket.data.roomId);
    if (r) r.detach(socket);
  });
});

async function main() {
  // Saved tables: connect to Redis (if REDIS_URL is set) and bring back any tables from before a restart.
  try {
    if (await store.connect()) console.log('Saved tables: on (Render Key Value). Tables load when someone opens them.');
    else console.log('Saved tables: off (no REDIS_URL), tables live in memory only.');
  } catch (err) {
    console.error('Saved tables: could not connect, tables live in memory only.', err.message);
  }
  server.listen(PORT, () => {
    console.log(`King's Gambit is running at http://localhost:${PORT}`);
  });
}

// Render stops the old server on every deploy: save every table before exiting.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    await store.flush().catch(() => {});
    process.exit(0);
  });
}

main();
