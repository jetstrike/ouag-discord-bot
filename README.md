# 🌌 Once Upon a Galaxy (OUAG) — Live Lobby & Tournament Discord Bot

A Discord bot designed specifically for **Once Upon a Galaxy (OUAG)**. It automates 6-player live lobbies with two distinct modes: **Continuous Casual Lobbies** and **Official Chekhov’s Gum Tournament Rules** (4 Swiss Rounds, Round 3 Cut, Carry-Over Points, and Match-Point Grand Finals).

---

## ✨ Features

### 🎮 1. Casual Lobbies Mode
* **Continuous 6-Player Queue**: Interactive buttons (`Join Queue`, `Leave`, `Submit Code`, `Start Match`) on a live Discord embed.
* **4-Character Alphanumeric Code**: Any player in the queue can submit the game code (e.g. `X8K2`). The embed dynamically updates with the code and player roster.
* **Match Start & Rapid Turnover**: Any player in the lobby can mark the match as started. The bot hides/cleans up the queue message and automatically spawns a fresh queue so the next group can immediately organize.

---

### 🏆 2. Official Tournament Format (Chekhov’s Gum Rules)

#### A. Tournament Structure
* **4 Swiss Rounds** followed by a **Finals Stage**.
* **Round 3 Cut**: After Swiss Round 3, the bottom third of players are eliminated from the tournament.
* **Finals Qualification**: The top 6 players by Swiss Points advance to the Finals after Round 4.

#### B. Matchmaking & Lobby Sizes
* **Swiss Matchmaking**: Round 1 is randomly seeded. In Round 2 and beyond, players are paired by tournament performance (Swiss points DESC, Carry-Over points DESC, 1st places DESC), while avoiding rematches where possible.
* **6-Player Pod Priority**: Partitions lobbies prioritizing full 6-player pods wherever mathematically possible, leaving the lowest point pods at the bottom short on users (e.g. 14 players -> `[6, 4, 4]`; 34 players -> five 6-player pods and one 4-player pod at the bottom).

#### C. Swiss Scoring & Carry-Over Points
* **Swiss Points**:
  * 1st Place = 6 Points
  * 2nd Place = 4 Points
  * 3rd Place = 3 Points
  * 4th Place = 2 Points
  * 5th Place = 1 Point
  * 6th Place = 0 Points
* **Carry-Over Points (Banked for Finals)**:
  * 1st Place = 4 Carry-Over Points
  * 2nd Place = 2 Carry-Over Points
  * 3rd–6th Place = 0 Carry-Over Points
  * *Note*: Carry-Over Points are tracked separately, used as the 1st tiebreaker for Finals qualification, and serve as starting points in the Finals!
* **Tied Placements**: Points for tied positions and the positions below are combined and divided equally.
  * *Example*: Two players tie for 2nd: `(4 + 3) / 2 = 3.5 Swiss pts`, `(2 + 0) / 2 = 1.0 Carry-Over pts`.
  * *Example*: Tie for 1st: `(6 + 4) / 2 = 5.0 Swiss pts`, `(4 + 2) / 2 = 3.0 Carry-Over pts`.

#### D. Finals Break & Qualification
* **15-Minute Break**: Automatically triggered after Round 4 for staff verification.
* **Tiebreak Order for 6th Place**:
  1. Total Carry-Over Points
  2. Head-to-Head record
  3. Live tiebreak lobby ruling

#### E. Finals Scoring & "Checkmate" Win Condition
* **Starting Scores**: Finalists begin with their accumulated Carry-Over Points. Swiss Points reset to 0.
* **Finals Scoring**:
  * 1st = 10 pts, 2nd = 8 pts, 3rd = 6 pts, 4th = 4 pts, 5th = 2 pts, 6th = 0 pts.
* **Becoming Eligible to Win (Check State)**:
  * A player becomes eligible to win once they have accumulated **20 or more Total Finals Points**.
* **Winning the Tournament**:
  * A player wins the championship when **BOTH** conditions are met:
    1. They have accumulated at least 20 Finals Points.
    2. They finish 1st place in a Finals lobby *while eligible*.

#### F. Stuck Lobbies & Game Crashes
* **Stuck Lobby Ruling**: Remaining players share 1st/2nd place points & carry-over points. Neither player may win the tournament from a stuck lobby.
* **Game Crashes**:
  * $\ge 3$ players remaining: Void lobby result and replay.
  * 2 players remaining: Awarded a tie for 1st and 2nd.

---

## 🗄️ Dual Database Support (Local SQLite or TiDB/MySQL)
* **Zero-Setup Local**: Runs right out of the box using embedded SQLite (`data/ouag_bot.db`).
* **24/7 Cloud TiDB / MySQL**: Ready to connect to your TiDB Cloud database simply by setting `USE_TIDB=true` in `.env`.

---

## 🚀 Quick Start Guide

### Step 1: Create Your Discord Bot Application
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, name it (e.g. `OUAG Lobby Organizer`), and click **Create**.
3. Under **Bot**:
   * Click **Reset Token** and copy your **Bot Token**.
   * Under **Privileged Gateway Intents**, enable:
     * ✅ **Server Members Intent**
     * ✅ **Message Content Intent**
   * Click **Save Changes**.
4. Under **OAuth2** > **URL Generator**:
   * Scopes: `bot`, `applications.commands`.
   * Bot Permissions: `Administrator` (or `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`, `Manage Messages`, `Create Private Threads`, `Embed Links`).
   * Open the generated link to invite the bot to your Discord server.
5. Copy your **Application ID** (`CLIENT_ID`) from **General Information**.

---

### Step 2: Configure `.env`

Copy `.env.example` to `.env`:
```ini
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_optional_server_id_here

# SQLite (default) or TiDB Cloud:
USE_TIDB=false
# TIDB_HOST=gateway01.us-east-1.prod.aws.tidbcloud.com
# TIDB_PORT=4000
# TIDB_USER=your_username
# TIDB_PASSWORD=your_password
# TIDB_DATABASE=ouag_lobbies
# TIDB_SSL=true
```

---

### Step 3: Run Tests & Start

```bash
# Run automated verification suite
npm test

# Start bot locally
npm start

# Run 24/7 in background with PM2
npm run pm2:start
npm run pm2:logs
```

---

## 📖 Command Reference

### Casual Lobbies
| Command | Permission | Description |
|---|---|---|
| `/casual setup [channel]` | `Manage Channels` | Creates the persistent Casual Queue Dashboard in the selected channel. |

### Tournament Mode
| Command | Permission | Description |
|---|---|---|
| `/tournament create` | `Manage Server` | Creates a new Chekhov's Gum tournament (4 Swiss rounds, 6 finalists, balanced pods). |
| `/tournament start` | Coordinator | Begins Swiss Round 1 (random seeding & balanced lobby sizes). |
| `/tournament next-round` | Coordinator | Advances to Swiss Round 2, 3, or 4 (auto triggers Round 3 Cut and 15-min break). |
| `/tournament start-finals` | Coordinator | Launches Grand Finals Lobby #1 with the Top 6 finalists. |
| `/tournament next-finals-round` | Coordinator | Launches subsequent Finals lobbies if no champion has satisfied the win condition. |
| `/tournament standings` | Everyone | Displays live Swiss standings or Finals checkmate standings. |
| `/tournament cut [count]` | Coordinator | Manually executes or adjusts the Round 3 Cut line. |
| `/tournament rule-stuck [pod_id] [p1] [p2]` | Coordinator | Rules a lobby stuck (remaining players share 1st/2nd; cannot win from stuck lobby). |
| `/tournament crash-replay [pod_id]` | Coordinator | Game crashed with $\ge 3$ players. Voids match and resets pod for replay. |
| `/tournament crash-two [pod_id] [p1] [p2]` | Coordinator | Game crashed with 2 players remaining. Awards tie for 1st and 2nd. |
| `/tournament add-player [user]` | Coordinator | Manually registers a player. |
| `/tournament drop-player [user]` | Coordinator | Drops a player from the tournament. |
| `/tournament add-bots [count]` | Coordinator | Adds mock bot players (1–64) for solo testing & dry runs without pinging anyone. |
| `/tournament cleanup [tournament_id] [delete_category]` | Coordinator | Cleans up all leftover pod channels, private threads, and issue ticket channels. |
| `/tournament cancel` | Coordinator | Cancels the active tournament, deletes pod/issue channels, and clears DB records. |
| `/ouag-help` | Everyone | Displays interactive bot guide and rules summary in Discord. |
