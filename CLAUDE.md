# King's Gambit

An online multiplayer card game for 2–8 players (bots fill empty seats), played in the browser. The table layout is modeled on PokerNow: an oval felt table, numbered seats, a shareable room link, a game log, and chat.

## Stack

- **Server:** Node.js + Express + Socket.IO. The server is authoritative: it holds the full game state and sends each player only the cards they are allowed to see.
- **Client:** plain HTML/CSS/JS served by the same server (no build step).
- **Tests:** Node's built-in test runner (`node --test`).

## Commands

- `npm install`: install dependencies
- `npm start`: run the server on http://localhost:3000
- `npm test`: run the game-engine tests

## Layout

- `server/engine/`: pure game logic (deck, rules, turns, powers, matching, scoring). No networking, fully unit-tested.
- `server/`: rooms, sockets, bots, per-player state views.
- `public/`: the web client.
- `test/`: engine tests.

## Game rules (source of truth)

- 54-card deck including both jokers. Four suits: Triangle, Circle, Chip, Spiral (the client draws them as line-art symbols). When the draw pile is empty, shuffle the discard pile (except its top card) back into it.
- Each player gets 4 face-down cards in a 2×2 grid. At the start, each player sees their bottom two cards once, then they flip back.
- **Values:** A=1, 2–10 face value, J=10, Q=10, Joker=0. Every King is a red King, worth −1. Goal: total of 5 or lower.
- **Turn:** draw from the deck, then either swap the drawn card with one of your cards (the old one goes to the discard pile) or discard the drawn card.
- **Powers** trigger for the card the current player puts on the discard pile on their turn: the drawn card if they discard it, or the card they replaced if they swap. Matched, penalty and timed-out discards never trigger a power. Anyone (including the player) can match that card as usual.
  - 7/8: look at one of your own cards.
  - 9/10: look at one of someone else's cards.
  - J: blind swap any two cards from two different players: yours with someone else's, or one other player's with another's. Knockers' cards can't be picked.
  - Q: look at any two cards (yours or others').
  - K: look at two cards, then optionally swap them.
  - Joker: blindly gather the cards of everyone except the player who discarded the Joker (and the knockers), shuffle them, and deal them back into the same slots. Nobody sees the result.
- **Matching (any time):** whenever the top of the discard pile is a single card, any active player can match it at any moment, even on someone else's turn. There is no timer; the server takes the first match it receives.
  - Matching your own card removes it from your hand (the slot stays empty).
  - Matching someone else's card removes it from their hand, and the matcher must then give that player one of their own cards (into the empty slot).
  - Once a pair is on top, nobody can match until a new card is discarded (no triple stacking).
  - A wrong match: the card stays, and the matcher draws one face-down penalty card.
  - A knocker's hand is frozen: it can't be matched, and a knocker can't match.
- **Knocking:** on your turn, instead of drawing, you can knock. Every other active player gets one last turn. During those final turns, anyone who hasn't knocked may also knock instead of drawing. Every knocker's cards are protected: they can't be swapped, matched, or reshuffled by a Joker. Final turns end when play gets back to the first knocker.
- **Knocker reveal:** after the final turns, every knocker's cards are revealed together.
  - Each knocker over 5 is out for the round, and their cards leave the table.
  - If at least one knocker has 5 or lower: everyone still in reveals; the lowest total wins (even if it isn't a knocker). Ties share the win.
  - If everyone still in the round knocked and all were over 5, nobody is knocked out: the lowest total wins (ties share).
  - If every knocker was over 5: play resumes from the player after the first knocker's seat until someone knocks again (and is protected again), and so on. If only one player is left, they win.
- **Wins:** every winner of a round (all tied winners too) adds one to their win counter, shown on their seat. The counter lasts while they keep their seat at the table.
- **Who starts:** the previous round's winner takes the first turn of the next round. With tied winners, the first of them clockwise after the previous round's starter goes first. Round 1 starts at the lowest seat.
- Single round, then the host can start a "New round".
- **Knock edge cases:** you can't knock twice or while you still owe a card from a match, and anyone who owes a knocker a card keeps it (a knocker's hand is frozen).
- **Power picks:** if a picked card is matched or moved before the power finishes, that pick no longer counts (pick again; a King can't swap it).
- **Turn timer:** a human has 45 seconds per turn. When it runs out the turn is skipped, and a drawn card is discarded without its power. Bots that make an illegal move forfeit their turn the same way.
- Peeked cards flip back face-down. The client must never show a card the player isn't currently allowed to see. No memory aid.

## Conventions

- Keep `server/engine/` free of I/O so it can be tested directly.
- Never send hidden card data to a client. Build each player's view on the server.
- Animations: the engine records public card movements in `game.motions` (positions only, never card ids or faces; `test/view.test.js` checks this). `public/js/table.js` plays new motions and flips cards that changed face up/down; `public/js/effects.js` + `public/css/effects.css` do the drawing (flights, flips, "looked at" glow, confetti). Respect `prefers-reduced-motion`.
- Every rule change goes in this file and in a test.

## Things to avoid

- Don't put game logic in the client. The client only renders and sends intents.
- Don't add a frontend framework or build step unless it's clearly needed.
- Don't scale the server past one instance: tables live in memory in a single Node process.

## Hosting (Render)

- Hosted on Render's free plan as one Node web service, defined in `render.yaml` (build `npm ci --omit=dev`, start `npm start`, health check `/healthz`, Node version from `package.json` `engines`). The server reads `PORT` from the environment.
- Tables are in memory only. A redeploy, restart, or free-tier sleep (after ~15 minutes with no visitors) clears every table. The first visit after a sleep takes about 30–60 s to load.
- **Deploying an update:** run `npm test`, commit, and `git push` to `main` on GitHub. Render auto-deploys `main`; watch the deploy in the Render dashboard, then open the site and play a round. Avoid pushing while friends are mid-game.
