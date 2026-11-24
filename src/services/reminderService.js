const queries = require('../database/queries');
const embeds = require('../utils/embeds');
const { formatMentionChunks } = require('../utils/timeParser');

async function sendReminderForTournament(client, tournament, type) {
  const claimed = await queries.markReminderSent(tournament.id, type);
  if (!claimed) return false;

  const channel = await client.channels.fetch(tournament.tournament_channel_id).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return false;

  const participants = await queries.getParticipants(tournament.id, true);
  const realIds = participants.filter(p => /^\d{17,20}$/.test(p.user_id)).map(p => p.user_id);
  const confirmedCount = participants.filter(p => p.checked_in === 1).length;

  const payload = embeds.createCheckInReminderEmbed(tournament, type, confirmedCount, participants.length);
  const chunks = formatMentionChunks(realIds);

  if (chunks.length > 0) {
    await channel.send({ content: chunks[0], ...payload }).catch(() => null);
    for (let i = 1; i < chunks.length; i++) {
      await channel.send({ content: chunks[i] }).catch(() => null);
    }
  } else {
    await channel.send(payload).catch(() => null);
  }
  return true;
}

/**
 * Checks scheduled tournaments and sends 2-hour check-in and 15-minute warning messages.
 */
async function processPendingReminders(client, nowSeconds = Math.floor(Date.now() / 1000)) {
  const pending = await queries.getTournamentsPendingReminders();
  for (const t of pending) {
    const diff = Number(t.start_time) - nowSeconds;
    if (!t.reminder_2h_sent && diff <= 2 * 3600 && diff > 15 * 60) {
      await sendReminderForTournament(client, t, '2h');
    } else if (!t.reminder_15m_sent && diff <= 15 * 60 && diff > -3600) {
      await sendReminderForTournament(client, t, '15m');
    }
  }
}

function startReminderLoop(client) {
  const interval = setInterval(() => {
    processPendingReminders(client).catch(err => {
      console.error('[ReminderService] Error checking reminders:', err.message);
    });
  }, 30000);
  if (typeof interval.unref === 'function') interval.unref();
  processPendingReminders(client).catch(() => null);
  return interval;
}

module.exports = {
  processPendingReminders,
  startReminderLoop
};
