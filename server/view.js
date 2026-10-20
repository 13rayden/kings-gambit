'use strict';

const { cardValue, powerOf } = require('./engine/cards');
const { MAX_PLAYERS, POWER_TEXT } = require('./engine/game');

/** A face-up card as the client sees it. Card ids are never sent, so hidden cards can't be tracked. */
function face(card) {
  return { rank: card.rank, suit: card.suit, red: card.red, value: cardValue(card) };
}

/**
 * What one player is allowed to know. Hidden cards are sent as { hidden: true }
 * with no identity at all; empty slots are null.
 */
function buildView(room, viewerId, feed = room.feed()) {
  const game = room.game;
  const me = viewerId ? game.player(viewerId) : null;

  const seats = [];
  for (let seat = 0; seat < MAX_PLAYERS; seat++) {
    const p = game.players.find((pl) => pl.seat === seat);
    if (!p) {
      seats.push(null);
      continue;
    }
    const hand = p.hand.map((card, slot) => {
      if (!card) return null;
      return game.canSee(viewerId, p.id, slot) ? face(card) : { hidden: true };
    });
    seats.push({
      seat,
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      status: p.status,
      connected: p.isBot || room.isConnected(p.id),
      knocked: !!game.knock && game.knock.by === p.id,
      hand,
      total: game.result && p.id in game.result.totals ? game.result.totals[p.id] : null,
      knockTotal: game.phase === 'knockReveal' && game.knock && game.knock.by === p.id ? game.knock.total : null,
      owesCard: game.pendingGive.has(p.id),
    });
  }

  const top = game.discard[game.discard.length - 1];
  const second = game.topPaired ? game.discard[game.discard.length - 2] : null;
  const myTurn = !!me && game.turnId === me.id;
  const drawnPower = myTurn && game.drawn ? powerOf(game.drawn) : null;

  return {
    roomId: room.id,
    me: me ? { id: me.id, seat: me.seat, status: me.status } : null,
    hostId: room.hostId,
    phase: game.phase,
    round: game.round,
    turnId: game.turnId,
    turnMsLeft: room.turnDeadline ? Math.max(0, room.turnDeadline - Date.now()) : null,
    turnMs: room.turnMs,
    knockBy: game.knock ? game.knock.by : null,
    seats,
    deckCount: game.deck.length,
    discard: {
      top: top ? face(top) : null,
      second: second ? face(second) : null,
      count: game.discard.length,
    },
    matchOpen: game.matchOpen(),
    drawn: game.drawn ? (myTurn ? face(game.drawn) : { hidden: true }) : null,
    // What discarding your drawn card would do; only you know what you drew.
    drawnPower: drawnPower ? POWER_TEXT[drawnPower].short : null,
    power: game.power
      ? {
        type: game.power.type,
        step: game.power.step,
        picks: game.power.picks.map((p) => ({ owner: p.owner, slot: p.slot })),
        title: POWER_TEXT[game.power.type].title,
        help: POWER_TEXT[game.power.type].help,
      }
      : null,
    // The cards this viewer may tap and what each tap does, so the client needs no rules.
    targets: viewerId ? game.legalTargets(viewerId) : [],
    matchTargets: viewerId ? game.matchTargets(viewerId) : [],
    pendingGive: me && game.pendingGive.has(me.id) ? { to: game.pendingGive.get(me.id).to } : null,
    ready: me ? game.ready.has(me.id) : false,
    result: game.result,
    // Public card movements (positions only) so every screen can animate them.
    motions: game.motions,
    feed,
  };
}

module.exports = { buildView };
