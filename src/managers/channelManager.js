const { ChannelType, PermissionFlagsBits } = require('discord.js');
const queries = require('../database/queries');

/**
 * Creates either a dedicated private text channel or a private thread for a pod of 6 players.
 * 
 * @param {import('discord.js').Guild} guild 
 * @param {object} tournament 
 * @param {object} pod 
 * @param {number} roundNumber 
 * @param {boolean} isFinals 
 * @param {Array<{user_id: string}>} players 
 * @returns {Promise<import('discord.js').TextChannel | import('discord.js').ThreadChannel>}
 */
async function createPodRoom(guild, tournament, pod, roundNumber, isFinals, players) {
  const channelName = isFinals 
    ? `grand-finals` 
    : `pod-${pod.pod_number}-r${roundNumber}`;

  if (tournament.channel_mode === 'thread') {
    // Mode: Discord Thread inside the tournament channel
    const parentChannel = await guild.channels.fetch(tournament.tournament_channel_id);
    if (!parentChannel) {
      throw new Error(`Tournament parent channel ${tournament.tournament_channel_id} not found.`);
    }

    const thread = await parentChannel.threads.create({
      name: channelName,
      autoArchiveDuration: 1440, // 24 hours
      type: ChannelType.PrivateThread,
      reason: `OUAG Tournament Pod #${pod.pod_number}`
    });

    // Add each real player to the thread
    for (const player of players) {
      if (/^\d{17,20}$/.test(player.user_id)) {
        try {
          await thread.members.add(player.user_id);
        } catch (err) {
          console.warn(`[ChannelManager] Could not add player ${player.user_id} to thread:`, err.message);
        }
      }
    }

    // Always add the tournament creator/coordinator to every thread
    if (tournament.created_by && /^\d{17,20}$/.test(tournament.created_by)) {
      try {
        await thread.members.add(tournament.created_by);
      } catch (err) {}
    }

    // Always add server owner to every thread
    if (guild.ownerId && /^\d{17,20}$/.test(guild.ownerId)) {
      try {
        await thread.members.add(guild.ownerId);
      } catch (err) {}
    }

    // Add all members with coordinator role to the thread using role cache
    if (tournament.coordinator_role_id) {
      try {
        const role = guild.roles.cache.get(tournament.coordinator_role_id) || await guild.roles.fetch(tournament.coordinator_role_id).catch(() => null);
        if (role && role.members) {
          for (const [mId] of role.members) {
            await thread.members.add(mId).catch(() => null);
          }
        }
      } catch (err) {}
    }

    return thread;
  } else {
    // Mode: Dedicated Text Channel under a Category
    let category = null;
    if (tournament.category_id) {
      category = await guild.channels.fetch(tournament.category_id).catch(() => null);
    }

    // Prepare permission overwrites:
    // 1. Deny @everyone
    // 2. Allow bot
    // 3. Allow coordinator role (if defined)
    // 4. Allow tournament creator & guild owner
    // 5. Allow the players
    const permissionOverwrites = [
      {
        id: guild.id, // @everyone
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages
        ]
      }
    ];

    if (tournament.coordinator_role_id) {
      permissionOverwrites.push({
        id: tournament.coordinator_role_id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }

    if (tournament.created_by && /^\d{17,20}$/.test(tournament.created_by)) {
      permissionOverwrites.push({
        id: tournament.created_by,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }

    if (guild.ownerId && /^\d{17,20}$/.test(guild.ownerId)) {
      permissionOverwrites.push({
        id: guild.ownerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }

    for (const player of players) {
      if (/^\d{17,20}$/.test(player.user_id)) {
        permissionOverwrites.push({
          id: player.user_id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks
          ]
        });
      }
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category ? category.id : null,
      permissionOverwrites,
      topic: `OUAG Tournament ${tournament.name} | Round ${roundNumber} Pod #${pod.pod_number}`
    });

    return channel;
  }
}

/**
 * Closes or deletes a pod room once finished.
 */
async function cleanupPodRoom(guild, channelId, mode) {
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    if (mode === 'thread' && channel.isThread()) {
      await channel.setLocked(true, 'Match completed');
      await channel.setArchived(true, 'Match completed');
    } else {
      // For text channels, delete or archive
      await channel.delete('Pod match completed');
    }
  } catch (err) {
    console.error(`[ChannelManager] Error cleaning up pod room ${channelId}:`, err.message);
  }
}

/**
 * Creates a private text channel (or private thread) for a user to report an issue to coordinators.
 * 
 * @param {import('discord.js').Guild} guild 
 * @param {object} tournament 
 * @param {import('discord.js').User} user 
 * @returns {Promise<{channel: import('discord.js').TextChannel | import('discord.js').ThreadChannel, isExisting: boolean}>}
 */
async function createIssueChannel(guild, tournament, user) {
  const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 20);
  const channelName = `issue-${cleanUsername}`;

  // If tournament uses thread mode
  if (tournament.channel_mode === 'thread') {
    const parentChannel = await guild.channels.fetch(tournament.tournament_channel_id).catch(() => null);
    if (!parentChannel) {
      throw new Error(`Tournament parent channel not found.`);
    }

    // Check active threads for existing issue
    const activeThreads = await parentChannel.threads.fetchActive().catch(() => null);
    const existingThread = activeThreads?.threads?.find(t => t.name === channelName && !t.archived);
    if (existingThread) {
      return { channel: existingThread, isExisting: true };
    }

    const thread = await parentChannel.threads.create({
      name: channelName,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `Tournament issue reported by ${user.username}`
    });

    await thread.members.add(user.id).catch(() => null);
    if (tournament.created_by && /^\d{17,20}$/.test(tournament.created_by)) {
      await thread.members.add(tournament.created_by).catch(() => null);
    }
    if (guild.ownerId && /^\d{17,20}$/.test(guild.ownerId)) {
      await thread.members.add(guild.ownerId).catch(() => null);
    }
    if (tournament.coordinator_role_id) {
      try {
        const role = guild.roles.cache.get(tournament.coordinator_role_id) || await guild.roles.fetch(tournament.coordinator_role_id).catch(() => null);
        if (role && role.members) {
          for (const [mId] of role.members) {
            await thread.members.add(mId).catch(() => null);
          }
        }
      } catch (err) {}
    }

    await queries.recordIssueChannel(tournament.id, thread.id, user.id);
    return { channel: thread, isExisting: false };
  } else {
    // Dedicated text channel mode under category
    let category = null;
    if (tournament.category_id) {
      category = await guild.channels.fetch(tournament.category_id).catch(() => null);
    }

    // Check if channel already exists
    const existingChannel = guild.channels.cache.find(c => 
      c.name === channelName && 
      (category ? c.parentId === category.id : true) && 
      c.type === ChannelType.GuildText
    );
    if (existingChannel) {
      return { channel: existingChannel, isExisting: true };
    }

    const permissionOverwrites = [
      {
        id: guild.id, // @everyone
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ];

    if (tournament.coordinator_role_id) {
      permissionOverwrites.push({
        id: tournament.coordinator_role_id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages
        ]
      });
    }

    if (tournament.created_by && /^\d{17,20}$/.test(tournament.created_by)) {
      permissionOverwrites.push({
        id: tournament.created_by,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    if (guild.ownerId && /^\d{17,20}$/.test(guild.ownerId)) {
      permissionOverwrites.push({
        id: guild.ownerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category ? category.id : null,
      permissionOverwrites,
      topic: `Issue reported by ${user.username} for ${tournament.name}`
    });

    await queries.recordIssueChannel(tournament.id, channel.id, user.id);
    return { channel, isExisting: false };
  }
}

/**
 * Cleans up all pod rooms, issue rooms, and threads created for a tournament.
 * 
 * @param {import('discord.js').Guild} guild 
 * @param {object} tournament 
 * @param {{ deleteCategory?: boolean }} options 
 * @returns {Promise<{ deletedChannels: number, deletedThreads: number, deletedCategory: boolean }>}
 */
async function cleanupTournamentChannels(guild, tournament, options = {}) {
  const result = {
    deletedChannels: 0,
    deletedThreads: 0,
    deletedCategory: false
  };

  if (!guild || !tournament) return result;

  const deletedIds = new Set();

  // 1. Delete all channels/threads recorded in tournament_pods
  try {
    const podChannelRows = await queries.getPodChannelIds(tournament.id);
    for (const row of podChannelRows) {
      if (!row.channel_id || deletedIds.has(row.channel_id)) continue;
      try {
        const ch = await guild.channels.fetch(row.channel_id).catch(() => null);
        if (ch) {
          if (ch.isThread()) {
            await ch.delete('Tournament cleanup');
            result.deletedThreads++;
          } else {
            await ch.delete('Tournament cleanup');
            result.deletedChannels++;
          }
          deletedIds.add(row.channel_id);
        }
      } catch (err) {
        console.warn(`[ChannelManager] Failed to delete pod channel ${row.channel_id}:`, err.message);
      }
    }
  } catch (err) {}

  // 2. Delete all issue channels recorded in tournament_issue_channels
  try {
    const issueRows = await queries.getIssueChannels(tournament.id);
    for (const row of issueRows) {
      if (!row.channel_id || deletedIds.has(row.channel_id)) continue;
      try {
        const ch = await guild.channels.fetch(row.channel_id).catch(() => null);
        if (ch) {
          if (ch.isThread()) {
            await ch.delete('Tournament cleanup');
            result.deletedThreads++;
          } else {
            await ch.delete('Tournament cleanup');
            result.deletedChannels++;
          }
          deletedIds.add(row.channel_id);
        }
      } catch (err) {}
    }
  } catch (err) {}

  // 3. If tournament has a category, clean up all remaining channels inside it
  if (tournament.category_id) {
    try {
      const category = await guild.channels.fetch(tournament.category_id).catch(() => null);
      if (category) {
        const allChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
        const children = allChannels.filter(c => c && c.parentId === category.id);
        for (const [cId, child] of children) {
          if (deletedIds.has(cId)) continue;
          try {
            await child.delete('Tournament cleanup');
            result.deletedChannels++;
            deletedIds.add(cId);
          } catch (err) {
            console.warn(`[ChannelManager] Failed to delete category child ${cId}:`, err.message);
          }
        }

        if (options.deleteCategory) {
          try {
            await category.delete('Tournament cleanup');
            result.deletedCategory = true;
          } catch (err) {
            console.warn(`[ChannelManager] Failed to delete category ${category.id}:`, err.message);
          }
        }
      }
    } catch (err) {}
  }

  // 4. If tournament uses thread mode, clean up remaining pod/issue threads under the parent channel
  if (tournament.tournament_channel_id) {
    try {
      const parentChannel = await guild.channels.fetch(tournament.tournament_channel_id).catch(() => null);
      if (parentChannel && parentChannel.threads) {
        const active = await parentChannel.threads.fetchActive().catch(() => null);
        if (active?.threads) {
          for (const [tId, thread] of active.threads) {
            if (deletedIds.has(tId)) continue;
            const name = thread.name.toLowerCase();
            if (name.startsWith('pod-') || name.startsWith('issue-') || name === 'grand-finals') {
              try {
                await thread.delete('Tournament cleanup');
                result.deletedThreads++;
                deletedIds.add(tId);
              } catch (err) {}
            }
          }
        }

        const archived = await parentChannel.threads.fetchArchived().catch(() => null);
        if (archived?.threads) {
          for (const [tId, thread] of archived.threads) {
            if (deletedIds.has(tId)) continue;
            const name = thread.name.toLowerCase();
            if (name.startsWith('pod-') || name.startsWith('issue-') || name === 'grand-finals') {
              try {
                await thread.delete('Tournament cleanup');
                result.deletedThreads++;
                deletedIds.add(tId);
              } catch (err) {}
            }
          }
        }
      }
    } catch (err) {}
  }

  return result;
}

module.exports = {
  createPodRoom,
  cleanupPodRoom,
  createIssueChannel,
  cleanupTournamentChannels
};
