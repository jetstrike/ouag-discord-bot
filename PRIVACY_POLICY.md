# Privacy Policy — Once Upon a Galaxy (OUAG) Discord Bot

**Last Updated:** November 18, 2026

This Privacy Policy explains what data the **Once Upon a Galaxy (OUAG) Discord Bot** ("the Bot") collects, how that data is used and stored, and how users and server administrators can manage or delete it.

---

## 1. Data We Collect and Store

The Bot only stores the minimum data strictly required to organize casual lobbies and run Chekhov's Gum tournaments inside Discord:

* **Discord Server & Channel Identifiers:**
  * Server (`guild_id`), channel (`channel_id`, `tournament_channel_id`, `results_channel_id`, `category_id`), message (`message_id`), and coordinator role (`coordinator_role_id`) IDs used to post embeds, manage match rooms, and clean up temporary channels.
* **Discord User Identifiers:**
  * User IDs (`user_id`) and Discord usernames (`username`) of players who join a casual queue, submit a lobby code, register for a tournament, or open an issue ticket, as well as the tournament creator's user ID (`created_by`).
* **Gameplay & Tournament Records:**
  * 4-character in-game OUAG lobby codes submitted by players.
  * Tournament registrations, participant statuses (`registered`, `dropped`, `eliminated_cut`, `finalist`), pod assignments, reported match placements, Swiss points, Carry-Over points, Finals points, head-to-head matchup history, and timestamps.

---

## 2. Data We Do NOT Collect

* **Message Content:** The Bot does **not** request Discord's `MessageContent` intent and does not read, log, or store messages sent in your server channels or Direct Messages.
* **Member Lists / Presence:** The Bot does **not** request Discord's `GuildMembers` or `GuildPresences` intents and does not scrape or store server member lists, online statuses, or activity data.
* **Personal / Sensitive Information:** The Bot does not collect email addresses, real names, IP addresses, locations, or payment details.

---

## 3. How Data Is Used

Stored data is used exclusively to:
* Maintain live 6-player casual lobby queues and announce match starts.
* Pair Swiss rounds (including rematch minimization), apply Round 3 cuts, calculate Swiss/Carry-Over/Finals scores, and display leaderboards.
* Create and clean up private pod match rooms and coordinator issue ticket channels.

---

## 4. Data Storage, Security & Third Parties

* **Storage Location:** Depending on the bot host's configuration, data is stored either in a local SQLite database file (`data/ouag_bot.db`) on the host machine or in a TiDB/MySQL database configured by the bot host over TLS.
* **Third-Party Sharing:** The Bot only communicates with Discord's API to function. No user or server data is sold, rented, or shared with advertisers, analytics services, or third parties.
* **Self-Hosted Instances:** This software is open-source. If you invite a community-hosted instance or self-host your own copy from this repository, the operator of that specific bot instance acts as the data controller for its database.

---

## 5. Data Retention and Deletion

* **Temporary Channels & Issue Tickets:** Pod match rooms and issue ticket channels are automatically deleted or archived upon resolution, and coordinators can purge all leftover channels and threads at any time using `/tournament cleanup`.
* **Withdrawing / Dropping:** Players may withdraw before a tournament starts using the **Withdraw** button, or drop at any time via the **Drop** button or `/tournament drop-player`.
* **Full Tournament Deletion:** Running `/tournament cancel` permanently deletes all database rows associated with that tournament (participants, rounds, pods, placements, matchups, and issue channel records) along with its Discord channels/threads.
* **Manual Data Removal Requests:** Server administrators or users who wish to have all records associated with their Discord server or user ID permanently removed may contact the operator/host of the bot instance running in their server.
