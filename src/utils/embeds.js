const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config');

/**
 * Creates the persistent Casual Queue embed and interactive buttons.
 */
function createCasualQueueMessage(lobby, players = []) {
  const count = players.length;
  const isFull = count >= config.LOBBY_SIZE;
  const hasCode = Boolean(lobby.lobby_code);

  const embed = new EmbedBuilder()
    .setTitle('🎮 Once Upon a Galaxy — Casual Lobby')
    .setColor(isFull ? config.COLORS.SUCCESS : config.COLORS.PRIMARY)
    .setTimestamp();

  // Status & Code
  let statusText = `Waiting for players... (${count}/${config.LOBBY_SIZE})`;
  if (isFull) {
    statusText = hasCode 
      ? '🟢 **Lobby Full & Code Ready!** Anyone in the lobby can start the match.'
      : '🟡 **Lobby Full!** Any player in the lobby can submit the 4-char game code.';
  } else if (hasCode) {
    statusText = `🟡 Lobby code is set, waiting for more players (${count}/${config.LOBBY_SIZE}).`;
  }

  embed.setDescription(
    `Welcome to the live lobby queue! Join below to assemble a 6-player match.\n\n` +
    `**Status**: ${statusText}\n` +
    `**Lobby Code**: ${hasCode ? `\`${lobby.lobby_code}\`` : '*Not submitted yet*'}` +
    (hasCode && lobby.code_submitted_by ? ` *(by <@${lobby.code_submitted_by}>)*` : '')
  );

  // Player Slots
  const playerSlots = [];
  for (let i = 0; i < config.LOBBY_SIZE; i++) {
    if (i < count) {
      playerSlots.push(`\`#${i + 1}\` <@${players[i].user_id}> (${players[i].username})`);
    } else {
      playerSlots.push(`\`#${i + 1}\` *[Empty Slot]*`);
    }
  }

  embed.addFields({
    name: `👥 Players In Queue (${count}/${config.LOBBY_SIZE})`,
    value: playerSlots.join('\n')
  });

  embed.setFooter({
    text: `Lobby #${lobby.id} • OUAG Live Organizer`
  });

  // Buttons
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`casual_join_${lobby.id}`)
      .setLabel('Join Queue')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎮')
      .setDisabled(isFull),
    new ButtonBuilder()
      .setCustomId(`casual_leave_${lobby.id}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🚪'),
    new ButtonBuilder()
      .setCustomId(`casual_code_${lobby.id}`)
      .setLabel(hasCode ? 'Update Code' : 'Submit Code')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔑'),
    new ButtonBuilder()
      .setCustomId(`casual_start_${lobby.id}`)
      .setLabel('Start Match')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🚀')
      .setDisabled(!hasCode)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Creates the Tournament Pod embed inside the pod's temporary channel/thread.
 */
function createTournamentPodMessage(pod, players, roundNumber, isFinals = false, finalsRoundNumber = 1) {
  const hasCode = Boolean(pod.lobby_code);
  const isStarted = pod.status === 'started';
  const isCompleted = pod.status === 'completed';

  let color = config.COLORS.PRIMARY;
  if (isFinals) color = config.COLORS.GOLD;
  else if (isCompleted) color = config.COLORS.SUCCESS;
  else if (isStarted) color = config.COLORS.WARNING;

  const titlePrefix = isFinals 
    ? `🏆 GRAND FINALS — Lobby #${finalsRoundNumber}` 
    : `⚔️ Swiss Round ${roundNumber} — Pod #${pod.pod_number}`;

  const embed = new EmbedBuilder()
    .setTitle(titlePrefix)
    .setColor(color)
    .setTimestamp();

  // Status text
  let statusDesc = '';
  if (isCompleted) {
    statusDesc = '🏁 **Match Completed!** Placements recorded and sent to the results channel.';
  } else if (isStarted) {
    statusDesc = isFinals
      ? '⚔️ **Finals Match In Progress!** When the match concludes, each finalist must click **Report Placement** below.\n*(Note: A player must enter the match with 20+ Finals Points and finish 1st to win the Championship!)*'
      : '⚔️ **Match In Progress!** When the match concludes, each player must click **Report Placement** below.';
  } else if (hasCode) {
    statusDesc = '🟢 **Lobby Code Ready!** Players, join the OUAG lobby. The Lobby Leader or Coordinator can click **Start Match**.';
  } else {
    statusDesc = `👑 <@${pod.leader_user_id}> is the **Lobby Leader**!\nPlease create the OUAG match lobby and submit the 4-character code below.`;
  }

  embed.setDescription(
    `${statusDesc}\n\n` +
    `👑 **Lobby Leader**: <@${pod.leader_user_id}>\n` +
    `🔑 **Lobby Code**: ${hasCode ? `\`${pod.lobby_code}\`` : '*Waiting for code...*'}\n` +
    `📊 **Status**: \`${pod.status.toUpperCase().replace('_', ' ')}\``
  );

  // Roster / Placement status
  const rosterLines = players.map((p, idx) => {
    let placementText = '⏳ Waiting for match...';
    if (isCompleted || p.placement) {
      const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
      const medal = medals[p.placement] || '🎖️';
      if (isFinals) {
        placementText = `${medal} **Rank ${p.placement}** (+${p.finals_points_awarded || 0} Finals pts)`;
      } else {
        placementText = `${medal} **Rank ${p.placement}** (+${p.points_awarded || 0} Swiss, +${p.carry_over_awarded || 0} Carry-Over)`;
      }
    } else if (isStarted) {
      placementText = '⏳ In Game (Placement pending)';
    }

    const isLeader = p.user_id === pod.leader_user_id ? ' 👑' : '';
    const isLive = p.is_eligible_to_win ? ' 🎯 [LIVE TO WIN]' : '';
    const isMock = !/^\d{17,20}$/.test(p.user_id);
    const userDisplay = isMock ? `**${p.username || p.user_id}**` : `<@${p.user_id}>`;
    return `\`#${idx + 1}\` ${userDisplay}${isLeader}${isLive} — ${placementText}`;
  });

  embed.addFields({
    name: `👥 Pod Roster (${players.length} Players)`,
    value: rosterLines.join('\n') || '*No players in pod*'
  });

  embed.setFooter({
    text: `Pod ID: ${pod.id} • Chekhov's Gum Tournament Rules`
  });

  // Action row
  const buttons = [];

  if (!isStarted && !isCompleted) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`pod_code_${pod.id}`)
        .setLabel(hasCode ? 'Update Code' : 'Submit Code')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔑'),
      new ButtonBuilder()
        .setCustomId(`pod_start_${pod.id}`)
        .setLabel('Start Match')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🚀')
        .setDisabled(!hasCode),
      new ButtonBuilder()
        .setCustomId(`pod_simulate_${pod.id}`)
        .setLabel('Simulate')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚡'),
      new ButtonBuilder()
        .setCustomId(`pod_drop_${pod.id}`)
        .setLabel('Drop')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🚪')
    );
  } else if (isStarted) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`pod_report_${pod.id}`)
        .setLabel(`Report Rank (1-${players.length})`)
        .setStyle(ButtonStyle.Success)
        .setEmoji('🏆'),
      new ButtonBuilder()
        .setCustomId(`pod_simulate_${pod.id}`)
        .setLabel('Simulate')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('⚡'),
      new ButtonBuilder()
        .setCustomId(`pod_override_${pod.id}`)
        .setLabel('Override')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🛠️'),
      new ButtonBuilder()
        .setCustomId(`pod_drop_${pod.id}`)
        .setLabel('Drop')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🚪')
    );
  }

  const rows = [];
  if (buttons.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(...buttons));
  }

  return { embeds: [embed], components: rows };
}

/**
 * Creates Tournament Results Card for the results channel.
 */
function createMatchResultsEmbed(tournament, roundNumber, podNumber, resultsWithPlayers, isFinals = false, championUser = null) {
  const embed = new EmbedBuilder()
    .setTitle(
      isFinals 
        ? `🏆 GRAND FINALS LOBBY RESULTS — ${tournament.name}` 
        : `📊 Swiss Round ${roundNumber} | Pod #${podNumber} Results`
    )
    .setColor(championUser ? config.COLORS.GOLD : config.COLORS.PRIMARY)
    .setTimestamp();

  const medals = { 1: '🥇', 2: '🥈', 3: '🥉', 4: '4th', 5: '5th', 6: '6th' };

  const lines = resultsWithPlayers.map((res) => {
    const medal = medals[res.placement] || `${res.placement}th`;
    const isMock = !/^\d{17,20}$/.test(res.user_id);
    const userDisplay = isMock ? `**${res.username}**` : `<@${res.user_id}> (${res.username})`;
    if (isFinals) {
      return `${medal} ${userDisplay} — **+${res.finals_points_awarded ?? res.points ?? 0} Finals pts** (Rank ${res.placement})`;
    } else {
      return `${medal} ${userDisplay} — **+${res.points_awarded ?? res.points ?? 0} Swiss** | **+${res.carry_over_awarded ?? 0} Carry-Over** (Rank ${res.placement})`;
    }
  });

  if (championUser) {
    const isMockChamp = !/^\d{17,20}$/.test(championUser.user_id);
    const champDisplay = isMockChamp ? `**${championUser.username}**` : `<@${championUser.user_id}> (${championUser.username})`;
    embed.setDescription(
      `👑 **TOURNAMENT CHAMPION CROWNED!** 👑\n` +
      `Congratulations to ${champDisplay} for meeting the win condition (20+ Finals Points & 1st Place)!\n\n` +
      lines.join('\n')
    );
  } else {
    embed.setDescription(lines.join('\n'));
  }

  embed.setFooter({ text: `${tournament.name} • Official OUAG Tournament` });
  return embed;
}

/**
 * Creates Tournament Standings leaderboard with Cut Line and Finals Qualification.
 */
function createStandingsEmbed(tournament, standings, stage = 'swiss', cutCount = 0) {
  const isFinals = stage === 'finals';

  const embed = new EmbedBuilder()
    .setTitle(isFinals ? `🏆 ${tournament.name} — Grand Finals Standings` : `🏆 ${tournament.name} — Swiss Standings`)
    .setColor(isFinals ? config.COLORS.GOLD : config.COLORS.COSMIC)
    .setTimestamp();

  if (isFinals) {
    embed.setDescription(
      `**Win Condition**: Accumulate **20+ Finals Points** to become "Live", then finish **1st place** in a Finals lobby to win!\n` +
      `*(Carry-Over points from Swiss are included in Starting Finals Points)*`
    );

    const lines = standings.map((player, index) => {
      const rank = index + 1;
      const isLive = (player.finals_points >= config.TOURNAMENT_RULES.FINALS_WIN_THRESHOLD || player.is_eligible_to_win);
      const liveBadge = isLive ? ' 🎯 **[ELIGIBLE TO WIN]**' : '';
      const isMock = !/^\d{17,20}$/.test(player.user_id);
      const userDisplay = isMock ? `**${player.username || player.user_id}**` : `<@${player.user_id}>`;
      return `\`#${rank}\` ${userDisplay} — **${player.finals_points} Finals Pts** (Started w/ ${player.carry_over_points} Carry-Over)${liveBadge}`;
    });

    embed.addFields({
      name: '👑 Finalists Leaderboard',
      value: lines.join('\n') || '*No finalists registered*'
    });

    return embed;
  }

  // Swiss stage
  let subText = `Current standings after Round ${tournament.current_round} of ${config.TOURNAMENT_RULES.SWISS_ROUNDS}.\n` +
                `• **Top 6** advance to Grand Finals.\n` +
                `• Carry-Over Points stored for Finals (1st: 4pts, 2nd: 2pts) and serve as 1st tiebreaker.`;

  if (tournament.current_round === 3 && cutCount > 0) {
    subText += `\n\n⚠️ **Round 3 Cut Active**: Bottom third (${cutCount} players) have been eliminated.`;
  }

  embed.setDescription(subText);

  if (!standings || standings.length === 0) {
    embed.addFields({ name: 'Leaderboard', value: '*No participants registered yet.*' });
    return embed;
  }

  const activePlayers = standings.filter(p => p.status === 'registered');
  const cutPlayers = standings.filter(p => p.status === 'eliminated_cut');

  const lines = [];
  activePlayers.forEach((player, index) => {
    const rank = index + 1;
    let prefix = `\`#${rank}\``;
    if (rank === 1) prefix = '🥇';
    else if (rank === 2) prefix = '🥈';
    else if (rank === 3) prefix = '🥉';
    else if (rank <= 6) prefix = `🌟 \`#${rank}\``; // Finals qualifier highlight

    const isMock = !/^\d{17,20}$/.test(player.user_id);
    const userDisplay = isMock ? `**${player.username || player.user_id}**` : `<@${player.user_id}>`;

    lines.push(
      `${prefix} ${userDisplay} — **${player.points} Swiss Pts** | Carry-Over: **${player.carry_over_points}** | 1sts: ${player.first_places}`
    );
  });

  // Chunk lines so no embed field value ever exceeds 1000 characters (Discord limit 1024)
  const CHUNK_SIZE = 8;
  if (lines.length === 0) {
    embed.addFields({ name: '🏅 Active Standings', value: '*No active players remaining.*' });
  } else {
    for (let i = 0; i < lines.length && i < 32; i += CHUNK_SIZE) {
      const chunk = lines.slice(i, i + CHUNK_SIZE);
      const startRank = i + 1;
      const endRank = i + chunk.length;
      const fieldTitle = lines.length <= CHUNK_SIZE
        ? `🏅 Active Standings (${activePlayers.length} Players)`
        : `🏅 Standings (Ranks ${startRank}–${endRank})`;

      embed.addFields({
        name: fieldTitle,
        value: chunk.join('\n')
      });
    }

    if (lines.length > 32) {
      embed.addFields({
        name: 'Additional Players',
        value: `*...and ${lines.length - 32} more players.*`
      });
    }
  }

  if (cutPlayers.length > 0) {
    const cutLines = cutPlayers.map(p => {
      const isMock = !/^\d{17,20}$/.test(p.user_id);
      const name = isMock ? `**${p.username || p.user_id}**` : `<@${p.user_id}>`;
      return `❌ ${name} (${p.points} Swiss Pts)`;
    });

    let cutValue = '';
    let shownCount = 0;
    for (const item of cutLines) {
      const addition = (cutValue ? ', ' : '') + item;
      if ((cutValue + addition).length > 950) break;
      cutValue += addition;
      shownCount++;
    }
    if (shownCount < cutPlayers.length) {
      cutValue += ` ...and ${cutPlayers.length - shownCount} more`;
    }

    embed.addFields({
      name: `🔻 Eliminated at Round 3 Cut (${cutPlayers.length} Players)`,
      value: cutValue || '*None*'
    });
  }

  return embed;
}

/**
 * Creates 15-Minute Finals Break Embed (Section D.1).
 */
function createFinalsBreakEmbed(tournament, top6Finalists) {
  const embed = new EmbedBuilder()
    .setTitle(`☕ 15-MINUTE FINALS BREAK — ${tournament.name}`)
    .setColor(config.COLORS.GOLD)
    .setDescription(
      `Swiss Round 4 is complete! Tournament staff is taking a **15-minute break** to verify standings and prepare the Finals lobby.\n\n` +
      `Congratulations to the **Top 6 Finalists** advancing to the Grand Finals:\n` +
      top6Finalists.map((p, idx) => {
        const isMock = !/^\d{17,20}$/.test(p.user_id);
        const name = isMock ? `**${p.username || p.user_id}**` : `<@${p.user_id}>`;
        return `\`#${idx + 1}\` ${name} (${p.username}) — **${p.points} Swiss Pts** | Starting Carry-Over: **${p.carry_over_points} pts**`;
      }).join('\n') +
      `\n\n**Finals Format**:\n` +
      `• Players start with their Carry-Over Points.\n` +
      `• Reach **20+ Finals Points** to become eligible to win.\n` +
      `• Finish **1st Place** while eligible to become Tournament Champion!`
    )
    .setFooter({ text: `Finals will commence shortly. Stay tuned!` })
    .setTimestamp();

  return embed;
}

/**
 * Creates Tournament Registration Embed.
 */
function createRegistrationEmbed(tournament, participantCount = 0) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name} — Registration Open!`)
    .setColor(config.COLORS.PRIMARY)
    .setDescription(
      `Welcome to **${tournament.name}**!\n\n` +
      `**Tournament Structure** (Chekhov's Gum Format):\n` +
      `• **Swiss Stage**: 4 Swiss Rounds with random seeding & balanced lobby sizes.\n` +
      `• **Round 3 Cut**: Bottom third of players eliminated after Round 3.\n` +
      `• **Carry-Over Points**: 1st = 4 pts, 2nd = 2 pts (banked for Finals).\n` +
      `• **Finals Stage**: Top 6 advance. Reach 20+ Finals Points and take 1st place to win!\n\n` +
      `Click **Register** below to enter the tournament!`
    )
    .addFields({
      name: '👥 Registered Players',
      value: `**${participantCount}** players checked in.`
    })
    .setFooter({ text: `Tournament ID: ${tournament.id} • Click buttons below to manage entry` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tourney_reg_${tournament.id}`)
      .setLabel('Register')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎟️'),
    new ButtonBuilder()
      .setCustomId(`tourney_withdraw_${tournament.id}`)
      .setLabel('Withdraw')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Creates action buttons for Standings embeds (Report Issue and Drop Tournament).
 */
function createStandingsComponents(tournament) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tourney_report_issue_${tournament.id}`)
      .setLabel('Report Issue')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🚨'),
    new ButtonBuilder()
      .setCustomId(`tourney_drop_${tournament.id}`)
      .setLabel('Drop Tournament')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🚪')
  );
}

/**
 * Creates the initial notification message in an Issue Report channel.
 */
function createIssueChannelEmbed(tournament, user) {
  const coordPing = tournament.coordinator_role_id 
    ? `<@&${tournament.coordinator_role_id}>` 
    : (tournament.created_by && /^\d{17,20}$/.test(tournament.created_by) ? `<@${tournament.created_by}>` : '**Coordinators**');

  const embed = new EmbedBuilder()
    .setTitle(`🚨 Tournament Issue Report — ${tournament.name}`)
    .setColor(config.COLORS.WARNING)
    .setDescription(
      `Hello <@${user.id}>, tournament coordinators have been notified!\n\n` +
      `Please state your issue or question in detail here:\n` +
      `• Stuck in-game match or game crash?\n` +
      `• Missing opponent or disconnected player?\n` +
      `• Score discrepancy or coordinator ruling needed?\n\n` +
      `A coordinator will assist shortly. Click **Close / Resolve Issue** below once your issue has been handled.`
    )
    .setFooter({ text: `Ticket for ${user.username} • Tournament ID: ${tournament.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`issue_resolve_${tournament.id}`)
      .setLabel('Close / Resolve Issue')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔒')
  );

  return { content: `👋 <@${user.id}> ${coordPing}`, embeds: [embed], components: [row] };
}

module.exports = {
  createCasualQueueMessage,
  createTournamentPodMessage,
  createMatchResultsEmbed,
  createStandingsEmbed,
  createStandingsComponents,
  createFinalsBreakEmbed,
  createRegistrationEmbed,
  createIssueChannelEmbed
};
