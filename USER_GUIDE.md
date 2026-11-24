# OUAG Discord Bot — User Guide

Guide for players, tournament coordinators, and server admins using the **Once Upon a Galaxy (OUAG)** Discord bot.

---

## For Players

### Casual Lobbies
1. Go to your server's casual lobby channel and click **Join Queue**.
2. Once 6 players join (or anytime before starting), any player in the queue can click **Submit Code** and enter the 4-character in-game lobby code (for example `7X9K`).
3. Click **Start Match** once everyone is in the game lobby. The bot posts the match announcement and immediately spawns a fresh queue for the next group.
4. Click **Leave** anytime before the match starts if you need to step out.

### Tournament Registration
1. Click **Register** on the tournament announcement embed.
2. You can click **Withdraw** anytime before Round 1 starts.

### Playing Your Tournament Match
1. When a round starts, the bot creates a private pod channel or private thread for your lobby and pings everyone in it.
2. One player is randomly chosen as **Lobby Leader** (marked with a crown). The Lobby Leader creates the in-game OUAG lobby and clicks **Submit Code** to enter the 4-character code.
3. Once everyone joins the in-game lobby, the Lobby Leader (or a coordinator) clicks **Start Match**.
4. When the game ends, each player clicks **Report Rank** and selects their finishing placement (`1` through pod size).
   * If all players submit unique ranks (`1..N`), the pod finalizes automatically.
   * **Ties:** If two or more players tied for the same placement, a coordinator must verify and enter the tie using **Override**.

### Dropping & Reporting Issues
* **Drop:** You can leave a tournament anytime using **Drop** inside your pod room or **Drop Tournament** on any standings message. If you drop while assigned to an active pod, you are automatically assigned last place for that match and a new Lobby Leader is picked if needed.
* **Report Issue:** Click **Report Issue** on any standings message to open a private ticket channel/thread with tournament coordinators. Once resolved, click **Close / Resolve Issue** to close it.

---

## Tournament Format & Scoring (Chekhov's Gum)

* **Swiss Stage (4 Rounds):** Round 1 is seeded randomly. Rounds 2–4 pair players by score while avoiding rematches. Lobbies prioritize 6 players, leaving lower-point pods at 4 or 5 players if the player count isn't divisible by 6.
* **Swiss Points:** `1st = 6`, `2nd = 4`, `3rd = 3`, `4th = 2`, `5th = 1`, `6th = 0`.
* **Carry-Over Points:** `1st = 4`, `2nd = 2`, `3rd–6th = 0`. Carry-Over points act as the first tiebreaker for Finals qualification and become your starting points in the Finals.
* **Tied Placements:** Combined points for the tied positions are split evenly (for example, a 2-way tie for 1st awards `(6 + 4) / 2 = 5` Swiss points and `(4 + 2) / 2 = 3` Carry-Over points each).
* **Round 3 Cut:** After Round 3 finishes, the bottom third of active players are eliminated.
* **Grand Finals (Top 6):** After Round 4, the top 6 players advance to Finals.
  * Finals scoring: `1st = 10`, `2nd = 8`, `3rd = 6`, `4th = 4`, `5th = 2`, `6th = 0`.
  * **Win Condition:** Reach **20+ total Finals points** to become eligible to win, then finish **1st place** in a Finals lobby while eligible to win the tournament.

---

## For Admins & Tournament Coordinators

### Who Counts as a Coordinator?
Anyone with Discord's **Administrator** or **Manage Server** permission, the server owner, or anyone holding the `coordinator_role` selected when creating the tournament.

### Setting Up Casual Lobbies
* Run `/casual setup [channel]` (requires **Manage Channels**). It posts or refreshes the persistent casual queue in that channel.

### Running a Tournament Step by Step
1. **Create:** Run `/tournament create` (requires **Manage Server**):
   * `name`: Tournament name (max 100 characters).
   * `channel_mode`: **Dedicated Text Channels (in Category)** or **Discord Private Threads**.
   * `results_channel`: Channel where completed match results are posted.
   * `category`: Category for pod/issue channels (when using Category mode).
   * `coordinator_role`: Optional Discord role allowed to run coordinator commands.
2. **Manage Signups (Optional):**
   * `/tournament add-player [player]` or `/tournament drop-player [player]`.
   * `/tournament add-bots [count]` adds 1–64 mock players for dry-run testing without pinging anyone.
3. **Start Swiss Rounds:**
   * Run `/tournament start` to launch Round 1.
   * After all pods in the round finish, run `/tournament next-round` for Rounds 2, 3, and 4.
   * Starting the next round automatically deletes or archives the previous round's pod rooms.
4. **Run Grand Finals:**
   * After Round 4 completes (Finals Break), run `/tournament start-finals` to launch Finals Lobby #1.
   * If no eligible player finishes 1st, run `/tournament next-finals-round` until a champion is crowned.
5. **View Standings:** Anyone can run `/tournament standings` at any time.

### Handling Disputes, Crashes & Overrides
* **Override Placements:** Click **Override** inside a pod room, run `/tournament override-pod [pod_id] [placements]`, or use **Override** in the Admin Web View. Works on both active and completed pods (completed pods automatically roll back old points first).
* **Restart a Pod:** Run `/tournament restart-pod [pod_id]` or click **Restart Pod** in the Admin Web View to roll back scores (if completed) and reopen the match room for a replay.
* **Stuck Lobby (`/tournament rule-stuck [pod_id] [p1] [p2]`):** Splits 1st/2nd place points between the two remaining players; a champion cannot be crowned from a stuck lobby.
* **Game Crash (3+ players left):** `/tournament crash-replay [pod_id]` voids the match and resets the pod for a new lobby code.
* **Game Crash (2 players left):** `/tournament crash-two [pod_id] [p1] [p2]` awards a 1st/2nd tie between those two players.
* **Manual Cut:** `/tournament cut [count]` eliminates the bottom `count` active players.
* **Cleanup / Cancel:**
  * `/tournament cleanup [tournament_id] [delete_category]` deletes leftover pod rooms, threads, and issue tickets created for that tournament without touching unrelated channels.
  * `/tournament cancel` cancels the active tournament, cleans up its channels/threads, and deletes its database records.

### Using the Admin Web Dashboard
If `WEB_PORT` is enabled on your host:
1. Open the dashboard URL and click **Sign in with Discord**.
2. You will only see servers where you are an Admin, Server Owner, or Tournament Coordinator.
3. From one screen you can:
   * Spot open player **Issue Reports** in the red alert banner and jump straight to the Discord ticket with **Open in Discord**.
   * View all pods, their secret 4-character lobby codes, Lobby Leaders, and reported placements.
   * Start/advance Swiss or Finals rounds, override per-player ranks, restart pods, apply stuck/crash rulings, drop players (with confirmation), or cancel the tournament (requires typing the tournament name).
