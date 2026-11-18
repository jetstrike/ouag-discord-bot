# OUAG Discord Bot

A Discord bot for **Once Upon a Galaxy** that manages 6-player casual lobby queues and Swiss/Finals tournaments (Chekhov's Gum format).

## Features

### Casual Lobbies
- Persistent 6-player queue embed with Join, Leave, Submit Code, and Start Match buttons.
- Any player in the queue can submit the 4-character lobby code and start the match.
- Starting a match clears the old queue message and posts a fresh one for the next group.

### Tournaments (Chekhov's Gum Format)
- **Swiss Stage (4 rounds):** Round 1 is seeded randomly; Rounds 2–4 pair by score while minimizing rematches. Lobbies prioritize 6 players, leaving lower-point pods at 4 or 5 players (e.g., 14 players -> `6, 4, 4`).
- **Scoring:** Swiss points (`6, 4, 3, 2, 1, 0`) and Carry-Over points (`4, 2, 0, 0, 0, 0`). Tied placements split the combined points of the tied positions evenly.
- **Round 3 Cut:** Eliminates the bottom third of active players after Round 3.
- **Finals (Top 6):** Finalists start with their Carry-Over points. Finals lobbies award `10, 8, 6, 4, 2, 0`. Reaching 20+ Finals points makes a player eligible to win; finishing 1st in a Finals lobby while eligible wins the tournament.
- **Rulings & Support:** Built-in commands for stuck lobbies, game crashes (replay or 2-player tie), player drop buttons, coordinator issue ticket channels, and channel/thread cleanup.

## Setup

### 1. Discord Application
1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Under **Bot**, generate and copy your token. Leave all Privileged Gateway Intents off (the bot only uses interactions).
3. Under **OAuth2 -> URL Generator**, select `bot` and `applications.commands`. Grant `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`, `Manage Messages`, `Create Private Threads`, and `Embed Links` (or `Administrator`), then invite the bot to your server.
4. Copy the Application ID (`CLIENT_ID`) from **General Information**.

### 2. Install & Configure
```bash
git clone https://github.com/jetstrike/ouag-discord-bot.git
cd ouag-discord-bot
npm install
cp .env.example .env
```

Fill in `.env` with your bot token and client ID:
```ini
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=

USE_TIDB=false
```

By default (`USE_TIDB=false`), the bot uses SQLite (`data/ouag_bot.db`) and creates all tables on first launch—no database setup needed. If you deploy on a host that wipes local files on restart, set `USE_TIDB=true` and add your TiDB/MySQL credentials (`TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE`) to `.env`; tables will be created automatically on startup.

### 3. Run
```bash
npm test
npm start
```

For background hosting with PM2:
```bash
npm run pm2:start
npm run pm2:logs
```

## Commands

| Command | Who | What it does |
|---|---|---|
| `/casual setup [channel]` | Manage Channels | Posts the persistent casual queue in a channel. |
| `/tournament create` | Manage Server | Creates a tournament (category channels or private threads). |
| `/tournament start` | Coordinator | Starts Swiss Round 1. |
| `/tournament next-round` | Coordinator | Starts the next Swiss round. |
| `/tournament start-finals` | Coordinator | Starts Grand Finals Lobby #1 with the Top 6. |
| `/tournament next-finals-round` | Coordinator | Starts the next Finals lobby if no one has won yet. |
| `/tournament standings` | Everyone | Shows current Swiss or Finals standings. |
| `/tournament cut [count]` | Coordinator | Manually eliminates the bottom `count` players. |
| `/tournament rule-stuck [pod_id] [p1] [p2]` | Coordinator | Splits 1st/2nd for remaining players; disables championship win for that lobby. |
| `/tournament crash-replay [pod_id]` | Coordinator | Voids a pod with 3+ players left so it can be replayed. |
| `/tournament crash-two [pod_id] [p1] [p2]` | Coordinator | Awards a 1st/2nd tie when a game crashes with 2 players left. |
| `/tournament add-player [player]` | Coordinator | Manually registers a player. |
| `/tournament drop-player [player]` | Coordinator | Drops a player from the tournament. |
| `/tournament add-bots [count]` | Coordinator | Adds 1–64 mock players for testing. |
| `/tournament cleanup [tournament_id] [delete_category]` | Coordinator | Deletes leftover pod channels, threads, and issue tickets. |
| `/tournament cancel` | Coordinator | Cancels the active tournament, cleans up rooms, and deletes its DB records. |
| `/ouag-help` | Everyone | Shows a quick summary of casual and tournament rules. |

## Privacy

See [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) for what data the bot stores and how to remove it.
