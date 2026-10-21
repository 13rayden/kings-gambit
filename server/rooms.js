'use strict';

const crypto = require('crypto');
const { Game, GameError, MAX_PLAYERS } = require('./engine/game');
const { BotBrain, BOT_NAMES } = require('./bots');
const { buildView } = require('./view');

const INITIAL_PEEK_MS = 6000;
const VIEW_MS = 6000;
const DECIDE_MS = 12000;
const KNOCK_REVEAL_MS = 3500;
const TURN_MS = 45000;
const BOT_TURN_MS = [1200, 2200];
const BOT_REACT_MS = [2500, 4500]; // slow enough that people can win a match race
const ROOM_IDLE_MS = 6 * 60 * 60 * 1000;

const rooms = new Map();

const randomId = (bytes = 6) => crypto.randomBytes(bytes).toString('base64url');
const between = ([lo, hi]) => lo + Math.random() * (hi - lo);

class Room {
  constructor(id) {
    this.id = id;
    this.game = new Game();
    this.hostId = null;
    this.tokens = new Map(); // token -> playerId
    this.sockets = new Set();
    this.brains = new Map(); // botId -> BotBrain
    this.chat = [];
    this.timers = new Map();
    this.turnDeadline = null;
    this.turnMs = TURN_MS;
    this.lastActive = Date.now();
  }

  // ---------- connections ----------

  attach(socket, token) {
    this.sockets.add(socket);
    socket.data.roomId = this.id;
    socket.data.playerId = (token && this.tokens.get(token)) || null;
    this.lastActive = Date.now();
    this.broadcast();
  }

  detach(socket) {
    this.sockets.delete(socket);
    this.broadcast();
  }

  isConnected(playerId) {
    for (const s of this.sockets) if (s.data.playerId === playerId) return true;
    return false;
  }

  // ---------- seating ----------

  sit(socket, seat, rawName) {
    if (socket.data.playerId) throw new GameError('You are already seated.');
    const name = String(rawName || '').trim().slice(0, 16);
    if (!name) throw new GameError('Enter a nickname.');
    if (this.game.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new GameError('That name is taken.');
    const id = `p_${randomId()}`;
    this.game.addPlayer({ id, name, seat });
    const token = randomId(18);
    this.tokens.set(token, id);
    socket.data.playerId = id;
    if (!this.hostId) this.hostId = id;
    this.say(`${name} sat down in seat ${seat + 1}.`);
    this.changed();
    return token;
  }

  leave(socket) {
    const id = socket.data.playerId;
    if (!id) return;
    const name = this.game.player(id).name;
    this.game.removePlayer(id);
    for (const [token, pid] of this.tokens) if (pid === id) this.tokens.delete(token);
    for (const s of this.sockets) if (s.data.playerId === id) s.data.playerId = null;
    if (this.hostId === id) this.hostId = this.nextHost();
    this.say(`${name} left the table.`);
    this.changed();
  }

  addBot(byId, seat) {
    this.requireHost(byId);
    this.seatBot(seat);
    this.changed();
  }

  fillWithBots(byId) {
    this.requireHost(byId);
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      if (!this.game.players.some((p) => p.seat === seat)) this.seatBot(seat);
    }
    this.changed();
  }

  seatBot(seat) {
    const used = new Set(this.game.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${seat + 1}`;
    const id = `b_${randomId()}`;
    this.game.addPlayer({ id, name, isBot: true, seat });
    this.brains.set(id, new BotBrain(id));
  }

  removeSeat(byId, seat) {
    this.requireHost(byId);
    const p = this.game.players.find((pl) => pl.seat === seat);
    if (!p) return;
    if (p.id === byId) throw new GameError('Use "Leave seat" to stand up.');
    this.game.removePlayer(p.id);
    this.brains.delete(p.id);
    for (const [token, pid] of this.tokens) if (pid === p.id) this.tokens.delete(token);
    for (const s of this.sockets) if (s.data.playerId === p.id) s.data.playerId = null;
    this.say(`${p.name} was removed from the table.`);
    this.changed();
  }

  start(byId) {
    this.requireHost(byId);
    this.game.start();
    this.changed();
  }

  requireHost(id) {
    if (!id || id !== this.hostId) throw new GameError('Only the host can do that.');
  }

  nextHost() {
    const human = this.game.players.find((p) => !p.isBot);
    return human ? human.id : null;
  }

  // ---------- play ----------

  act(playerId, action) {
    if (!playerId) throw new GameError('Take a seat to play.');
    this.game.act(playerId, action);
    this.changed();
  }

  say(text, from = null) {
    this.chat.push({ t: Date.now(), text, from });
    if (this.chat.length > 100) this.chat.shift();
  }

  postChat(playerId, rawText) {
    const text = String(rawText || '').trim().slice(0, 200);
    if (!text) return;
    const name = playerId ? this.game.player(playerId)?.name : null;
    this.say(text, name || 'Spectator');
    this.broadcast();
  }

  /** Game log and chat merged in time order, newest last. */
  feed() {
    const log = this.game.log.map((e) => ({ t: e.t, text: e.text, from: null, kind: 'log' }));
    const chat = this.chat.map((e) => ({ t: e.t, text: e.text, from: e.from, kind: e.from ? 'chat' : 'log' }));
    return [...log, ...chat].sort((a, b) => a.t - b.t).slice(-80);
  }

  // ---------- after every change ----------

  changed() {
    this.lastActive = Date.now();
    for (const brain of this.brains.values()) brain.observe(this.game);
    this.schedule();
    this.broadcast();
  }

  broadcast() {
    const feed = this.feed();
    for (const socket of this.sockets) socket.emit('state', buildView(this, socket.data.playerId, feed));
  }

  /** Starts any timers the current state needs. Each timer re-checks the state when it fires. */
  schedule() {
    const game = this.game;
    const phase = game.phase;
    // turnNo restarts every round, so timer keys and checks include the round too.
    const { round, turnNo } = game;
    const sameTurn = () => game.round === round && game.turnNo === turnNo;

    if (phase === 'initialPeek') {
      this.ensureTimer(`peek:${round}`, INITIAL_PEEK_MS, () => {
        if (game.phase === 'initialPeek' && game.round === round) game.finishInitialPeek();
      });
    }

    if (phase === 'power' && (game.power.step === 'viewing' || game.power.step === 'decide')) {
      const step = game.power.step;
      this.ensureTimer(`view:${round}:${turnNo}:${step}`, step === 'viewing' ? VIEW_MS : DECIDE_MS, () => {
        if (sameTurn() && game.phase === 'power' && game.power.step === step) game.powerDone(game.turnId);
      });
    }

    if (phase === 'knockReveal') {
      this.ensureTimer(`knock:${round}:${turnNo}`, KNOCK_REVEAL_MS, () => {
        if (game.phase === 'knockReveal' && sameTurn()) game.finishKnockReveal();
      });
    }

    // A human who wanders off doesn't stall the table.
    const current = game.turnId && game.player(game.turnId);
    if (current && !current.isBot && ['turn', 'drawn', 'power'].includes(phase)) {
      const key = `turn:${round}:${turnNo}`;
      if (!this.timers.has(key)) this.turnDeadline = Date.now() + TURN_MS;
      this.ensureTimer(key, TURN_MS, () => {
        if (sameTurn()) game.forfeitTurn(current.id);
      });
    } else {
      this.turnDeadline = null;
    }

    for (const [id, brain] of this.brains) {
      if (!game.player(id)) continue;
      if (brain.turnAction(game)) {
        this.ensureTimer(`botturn:${id}`, between(BOT_TURN_MS), () => {
          const action = brain.turnAction(game);
          if (!action) return;
          try {
            game.act(id, action);
          } catch (err) {
            if (!(err instanceof GameError)) throw err;
            // Never let a confused bot stall the table: give up its turn instead of retrying.
            console.warn(`Bot ${id} made an illegal move ${JSON.stringify(action)}: ${err.message}`);
            if (game.phase === 'initialPeek') game.markReady(id);
            else game.forfeitTurn(id);
          }
        });
      }
      if (brain.reactiveAction(game)) {
        this.ensureTimer(`botreact:${id}`, between(BOT_REACT_MS), () => {
          const action = brain.reactiveAction(game);
          if (action) game.act(id, action);
        });
      }
    }
  }

  ensureTimer(key, ms, fn) {
    if (this.timers.has(key)) return;
    const t = setTimeout(() => {
      this.timers.delete(key);
      try {
        fn();
      } catch (err) {
        if (!(err instanceof GameError)) console.error(err);
      }
      this.changed();
    }, ms);
    this.timers.set(key, t);
  }

  close() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}

function createRoom() {
  let id;
  do id = randomId(8); while (rooms.has(id));
  const room = new Room(id);
  rooms.set(id, room);
  return room;
}

function getRoom(id) {
  return rooms.get(id) || null;
}

/** Forget rooms nobody has touched in a while. */
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.sockets.size === 0 && now - room.lastActive > ROOM_IDLE_MS) {
      room.close();
      rooms.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = { createRoom, getRoom, Room };
