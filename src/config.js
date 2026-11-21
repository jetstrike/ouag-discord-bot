require('dotenv').config();

module.exports = {
  // Discord Bot Credentials
  DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
  CLIENT_ID: process.env.CLIENT_ID || '',
  GUILD_ID: process.env.GUILD_ID || '', // Optional: for instant guild slash command registration in development

  // Web Server, Discord OAuth2 & Public Webhooks
  WEB_PORT: parseInt(process.env.WEB_PORT || '0', 10),
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  TOURNAMENT_WEBHOOK_URLS: (process.env.TOURNAMENT_WEBHOOK_URLS || '')
    .split(',')
    .map(u => u.trim())
    .filter(Boolean),
  TOURNAMENT_WEBHOOK_SECRET: process.env.TOURNAMENT_WEBHOOK_SECRET || '',

  // Database Configuration
  // If USE_TIDB is 'true' (or unset with TIDB_HOST provided), connect to TiDB/MySQL via mysql2.
  // Explicit USE_TIDB=false always forces local SQLite even if TIDB_HOST is set.
  USE_TIDB: process.env.USE_TIDB === 'true' || (process.env.USE_TIDB !== 'false' && Boolean(process.env.TIDB_HOST)),
  TIDB: {
    host: process.env.TIDB_HOST || 'localhost',
    port: parseInt(process.env.TIDB_PORT || '4000', 10),
    user: process.env.TIDB_USER || 'root',
    password: process.env.TIDB_PASSWORD || '',
    database: process.env.TIDB_DATABASE || 'ouag_tournament',
    ssl: process.env.TIDB_SSL === 'false' ? false : { minVersion: 'TLSv1.2', rejectUnauthorized: true }
  },

  // Game & Lobby Defaults
  LOBBY_SIZE: 6,
  MIN_LOBBY_SIZE: 4,
  MAX_LOBBY_SIZE: 6,
  LOBBY_CODE_REGEX: /^[A-Za-z0-9]{4}$/,

  // Official Chekhov's Gum Tournament Format
  TOURNAMENT_RULES: {
    SWISS_ROUNDS: 4,
    CUT_ROUND: 3,                // Bottom third eliminated after Round 3
    FINALS_QUALIFIERS: 6,        // Top 6 advance to Finals
    FINALS_WIN_THRESHOLD: 20,    // Points needed to become "Eligible to Win"

    // Section B.3: Swiss Points (1st to 6th)
    SWISS_POINTS: [6, 4, 3, 2, 1, 0],

    // Section C.1: Carry-Over Points (1st=4, 2nd=2, 3rd-6th=0)
    CARRY_OVER_POINTS: [4, 2, 0, 0, 0, 0],

    // Section E.3: Finals Points (1st to 6th)
    FINALS_POINTS: [10, 8, 6, 4, 2, 0]
  },

  // Colors for Embeds (OUAG cosmic theme)
  COLORS: {
    PRIMARY: 0x5865F2,
    SUCCESS: 0x57F287,
    WARNING: 0xFEE75C,
    DANGER: 0xED4245,
    GOLD: 0xFFD700,
    COSMIC: 0x8A2BE2
  }
};
