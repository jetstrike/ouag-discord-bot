const fs = require('fs');
const path = require('path');
const config = require('../config');

let sqliteDb = null;
let mysqlPool = null;

async function initDb() {
  if (config.USE_TIDB) {
    const mysql = require('mysql2/promise');
    console.log(`[Database] Connecting to TiDB / MySQL at ${config.TIDB.host}:${config.TIDB.port}...`);
    try {
      mysqlPool = mysql.createPool({
        host: config.TIDB.host,
        port: config.TIDB.port,
        user: config.TIDB.user,
        password: config.TIDB.password,
        database: config.TIDB.database,
        ssl: config.TIDB.ssl,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      // Test connection
      await mysqlPool.query('SELECT 1');
      console.log('[Database] Successfully connected to TiDB / MySQL.');
      await createTablesTiDB();
    } catch (err) {
      console.error('[Database] Failed to connect to TiDB. Falling back to local SQLite:', err.message);
      config.USE_TIDB = false;
      initSqlite();
    }
  } else {
    initSqlite();
  }
}

function initSqlite() {
  const Database = require('better-sqlite3');
  let dbPath = process.env.SQLITE_PATH;
  if (!dbPath) {
    const dataDir = path.join(__dirname, '../../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    dbPath = path.join(dataDir, 'ouag_bot.db');
  }
  console.log(`[Database] Initializing local SQLite database at ${dbPath}`);
  sqliteDb = new Database(dbPath);
  if (dbPath !== ':memory:') {
    sqliteDb.pragma('journal_mode = WAL');
  }
  createTablesSqlite();
}

function ensureColumnSqlite(tableName, columnName, columnDef) {
  const columns = sqliteDb.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some(col => col.name === columnName);
  if (!exists) {
    sqliteDb.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
  }
}

function createTablesSqlite() {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS casual_lobbies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      status TEXT DEFAULT 'waiting', -- waiting, ready, started, completed, cancelled
      lobby_code TEXT,
      code_submitted_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS casual_players (
      lobby_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lobby_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'registration', -- registration, in_progress, completed, cancelled
      stage TEXT DEFAULT 'registration',  -- registration, swiss, finals_break, finals, completed
      current_round INTEGER DEFAULT 0,
      total_rounds INTEGER DEFAULT 4,
      finals_round_number INTEGER DEFAULT 0,
      channel_mode TEXT DEFAULT 'category', -- category or thread
      category_id TEXT,
      tournament_channel_id TEXT NOT NULL,
      results_channel_id TEXT,
      coordinator_role_id TEXT,
      points_config TEXT NOT NULL, -- JSON array of Swiss points
      start_time INTEGER,
      reminder_2h_sent INTEGER DEFAULT 0,
      reminder_15m_sent INTEGER DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_participants (
      tournament_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      points REAL DEFAULT 0.0, -- Swiss Points
      carry_over_points REAL DEFAULT 0.0, -- Carry-Over Points (1st=4, 2nd=2)
      finals_points REAL DEFAULT 0.0, -- Cumulative Finals Points
      is_eligible_to_win INTEGER DEFAULT 0, -- 1 when >= 20 Finals Points
      matches_played INTEGER DEFAULT 0,
      first_places INTEGER DEFAULT 0,
      checked_in INTEGER DEFAULT 0,
      status TEXT DEFAULT 'registered', -- registered, dropped, auto_dropped, eliminated_cut, finalist
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tournament_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      is_finals INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress', -- in_progress, completed
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tournament_pods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      pod_number INTEGER NOT NULL,
      channel_id TEXT,
      message_id TEXT,
      leader_user_id TEXT,
      lobby_code TEXT,
      status TEXT DEFAULT 'waiting_code', -- waiting_code, ready, started, completed, stuck, voided
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS tournament_pod_players (
      pod_id INTEGER NOT NULL,
      tournament_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      placement INTEGER,
      points_awarded REAL DEFAULT 0.0,
      carry_over_awarded REAL DEFAULT 0.0,
      finals_points_awarded REAL DEFAULT 0.0,
      reported_at DATETIME,
      PRIMARY KEY (pod_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_matchups (
      tournament_id INTEGER NOT NULL,
      player_a_id TEXT NOT NULL,
      player_b_id TEXT NOT NULL,
      round_number INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tournament_issue_channels (
      tournament_id INTEGER NOT NULL,
      channel_id TEXT NOT NULL PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrate new columns if upgrading existing db
  ensureColumnSqlite('tournaments', 'stage', "TEXT DEFAULT 'registration'");
  ensureColumnSqlite('tournaments', 'finals_round_number', 'INTEGER DEFAULT 0');
  ensureColumnSqlite('tournaments', 'start_time', 'INTEGER');
  ensureColumnSqlite('tournaments', 'reminder_2h_sent', 'INTEGER DEFAULT 0');
  ensureColumnSqlite('tournaments', 'reminder_15m_sent', 'INTEGER DEFAULT 0');
  ensureColumnSqlite('tournament_participants', 'carry_over_points', 'REAL DEFAULT 0.0');
  ensureColumnSqlite('tournament_participants', 'finals_points', 'REAL DEFAULT 0.0');
  ensureColumnSqlite('tournament_participants', 'is_eligible_to_win', 'INTEGER DEFAULT 0');
  ensureColumnSqlite('tournament_participants', 'checked_in', 'INTEGER DEFAULT 0');
  ensureColumnSqlite('tournament_pod_players', 'carry_over_awarded', 'REAL DEFAULT 0.0');
  ensureColumnSqlite('tournament_pod_players', 'finals_points_awarded', 'REAL DEFAULT 0.0');

  console.log('[Database] SQLite tables initialized & migrated.');
}

async function createTablesTiDB() {
  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS casual_lobbies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(64) NOT NULL,
      channel_id VARCHAR(64) NOT NULL,
      message_id VARCHAR(64),
      status VARCHAR(32) DEFAULT 'waiting',
      lobby_code VARCHAR(16),
      code_submitted_by VARCHAR(64),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS casual_players (
      lobby_id INT NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      username VARCHAR(128) NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lobby_id, user_id)
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      status VARCHAR(32) DEFAULT 'registration',
      stage VARCHAR(32) DEFAULT 'registration',
      current_round INT DEFAULT 0,
      total_rounds INT DEFAULT 4,
      finals_round_number INT DEFAULT 0,
      channel_mode VARCHAR(32) DEFAULT 'category',
      category_id VARCHAR(64),
      tournament_channel_id VARCHAR(64) NOT NULL,
      results_channel_id VARCHAR(64),
      coordinator_role_id VARCHAR(64),
      points_config TEXT NOT NULL,
      start_time BIGINT,
      reminder_2h_sent INT DEFAULT 0,
      reminder_15m_sent INT DEFAULT 0,
      created_by VARCHAR(64) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_participants (
      tournament_id INT NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      username VARCHAR(128) NOT NULL,
      points DOUBLE DEFAULT 0.0,
      carry_over_points DOUBLE DEFAULT 0.0,
      finals_points DOUBLE DEFAULT 0.0,
      is_eligible_to_win INT DEFAULT 0,
      matches_played INT DEFAULT 0,
      first_places INT DEFAULT 0,
      checked_in INT DEFAULT 0,
      status VARCHAR(32) DEFAULT 'registered',
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tournament_id, user_id)
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_rounds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tournament_id INT NOT NULL,
      round_number INT NOT NULL,
      is_finals INT DEFAULT 0,
      status VARCHAR(32) DEFAULT 'in_progress',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_pods (
      id INT AUTO_INCREMENT PRIMARY KEY,
      round_id INT NOT NULL,
      tournament_id INT NOT NULL,
      pod_number INT NOT NULL,
      channel_id VARCHAR(64),
      message_id VARCHAR(64),
      leader_user_id VARCHAR(64),
      lobby_code VARCHAR(16),
      status VARCHAR(32) DEFAULT 'waiting_code',
      started_at DATETIME,
      completed_at DATETIME
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_pod_players (
      pod_id INT NOT NULL,
      tournament_id INT NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      username VARCHAR(128) NOT NULL,
      placement INT,
      points_awarded DOUBLE DEFAULT 0.0,
      carry_over_awarded DOUBLE DEFAULT 0.0,
      finals_points_awarded DOUBLE DEFAULT 0.0,
      reported_at DATETIME,
      PRIMARY KEY (pod_id, user_id)
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_matchups (
      tournament_id INT NOT NULL,
      player_a_id VARCHAR(64) NOT NULL,
      player_b_id VARCHAR(64) NOT NULL,
      round_number INT NOT NULL
    );
  `);

  await mysqlPool.query(`
    CREATE TABLE IF NOT EXISTS tournament_issue_channels (
      tournament_id INT NOT NULL,
      channel_id VARCHAR(64) NOT NULL PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const ensureColumnTiDB = async (table, col, def) => {
    const [rows] = await mysqlPool.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [col]);
    if (rows.length === 0) {
      await mysqlPool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def}`);
    }
  };
  await ensureColumnTiDB('tournaments', 'start_time', 'BIGINT');
  await ensureColumnTiDB('tournaments', 'reminder_2h_sent', 'INT DEFAULT 0');
  await ensureColumnTiDB('tournaments', 'reminder_15m_sent', 'INT DEFAULT 0');
  await ensureColumnTiDB('tournament_participants', 'checked_in', 'INT DEFAULT 0');

  console.log('[Database] TiDB / MySQL tables initialized.');
}

async function all(sql, params = []) {
  if (config.USE_TIDB && mysqlPool) {
    const [rows] = await mysqlPool.query(sql, params);
    return rows;
  } else {
    return sqliteDb.prepare(sql).all(params);
  }
}

async function get(sql, params = []) {
  if (config.USE_TIDB && mysqlPool) {
    const [rows] = await mysqlPool.query(sql, params);
    return rows[0] || null;
  } else {
    return sqliteDb.prepare(sql).get(params) || null;
  }
}

async function run(sql, params = []) {
  if (config.USE_TIDB && mysqlPool) {
    const [result] = await mysqlPool.query(sql, params);
    return { insertId: result.insertId, changes: result.affectedRows };
  } else {
    const info = sqliteDb.prepare(sql).run(params);
    return { insertId: Number(info.lastInsertRowid), changes: info.changes };
  }
}

module.exports = {
  initDb,
  all,
  get,
  run
};
