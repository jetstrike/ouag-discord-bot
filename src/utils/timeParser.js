/**
 * Parses "YYYY-MM-DD HH:MM" (or ISO) in a given IANA timezone into UTC Unix seconds.
 */
function parseScheduledTime(input, timeZone = 'America/Chicago') {
  const match = String(input || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error('Invalid start_time format. Use YYYY-MM-DD HH:MM (24-hour), e.g. 2026-12-05 18:00.');
  }

  const [, y, m, d, hh, mm] = match.map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);

  // Compute timezone offset at utcGuess using Intl.DateTimeFormat
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date(utcGuess));

  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const tzHour = map.hour === '24' ? 0 : Number(map.hour);
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), tzHour, Number(map.minute), Number(map.second));
  const offsetMs = asUtc - utcGuess;
  const targetMs = utcGuess - offsetMs;

  if (Number.isNaN(targetMs)) {
    throw new Error('Could not parse scheduled start time.');
  }
  return Math.floor(targetMs / 1000);
}

/**
 * Splits user mentions into message chunks safely below Discord's 2000-character limit.
 */
function formatMentionChunks(userIds, prefix = '', maxLen = 1900) {
  const mentions = userIds.map(id => `<@${id}>`);
  if (mentions.length === 0) return prefix ? [prefix] : [];

  const chunks = [];
  let current = prefix ? `${prefix}\n` : '';
  for (const m of mentions) {
    const next = current.endsWith('\n') || current === '' ? `${current}${m}` : `${current} ${m}`;
    if (next.length > maxLen) {
      if (current.trim()) chunks.push(current.trim());
      current = m;
    } else {
      current = next;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

module.exports = {
  parseScheduledTime,
  formatMentionChunks
};
