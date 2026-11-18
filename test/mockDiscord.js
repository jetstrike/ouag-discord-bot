const { ChannelType, PermissionsBitField } = require('discord.js');

class MockCollection extends Map {
  find(fn) {
    for (const val of this.values()) {
      if (fn(val)) return val;
    }
    return undefined;
  }

  filter(fn) {
    const res = new MockCollection();
    for (const [k, v] of this.entries()) {
      if (fn(v, k)) res.set(k, v);
    }
    return res;
  }
}

function createMockGuild(guildId = '111111111111111111', ownerId = '100000000000000001') {
  const channels = new MockCollection();
  const messages = new Map();
  let idSeq = 500000000000000000n;
  const nextId = () => String(++idSeq);

  const client = {
    user: { id: '999999999999999999', tag: 'OUAG-Bot#0001' },
    guilds: {
      fetch: async (id) => (id === guildId ? guild : null)
    },
    channels: {
      fetch: async (id) => channels.get(id) || null
    }
  };

  function makeChannel({ id = nextId(), name, type = ChannelType.GuildText, parentId = null, isThread = false }) {
    const threadStore = new MockCollection();
    const ch = {
      id,
      name,
      type,
      parentId,
      guildId,
      guild,
      client,
      archived: false,
      locked: false,
      isThread: () => isThread,
      send: async (payload) => {
        const msgId = nextId();
        const msg = {
          id: msgId,
          channelId: id,
          channel: ch,
          payload: typeof payload === 'string' ? { content: payload } : payload,
          edit: async (newPayload) => {
            msg.payload = typeof newPayload === 'string' ? { content: newPayload } : newPayload;
            return msg;
          },
          delete: async () => {
            messages.delete(msgId);
          }
        };
        messages.set(msgId, msg);
        return msg;
      },
      delete: async () => {
        channels.delete(id);
      },
      setLocked: async (val) => { ch.locked = val; },
      setArchived: async (val) => { ch.archived = val; },
      messages: {
        fetch: async (msgId) => messages.get(msgId) || null
      },
      members: {
        add: async () => {}
      },
      threads: {
        create: async (opts) => {
          const t = makeChannel({ name: opts.name, type: opts.type, parentId: id, isThread: true });
          threadStore.set(t.id, t);
          return t;
        },
        fetchActive: async () => ({ threads: threadStore.filter(t => !t.archived) }),
        fetchArchived: async () => ({ threads: threadStore.filter(t => t.archived) })
      }
    };
    channels.set(id, ch);
    return ch;
  }

  const guild = {
    id: guildId,
    ownerId,
    client,
    roles: {
      cache: new MockCollection(),
      fetch: async () => null
    },
    channels: {
      cache: channels,
      fetch: async (id) => (id ? channels.get(id) || null : channels),
      create: async (opts) => makeChannel({ name: opts.name, type: opts.type, parentId: opts.parent || null })
    },
    _makeChannel: makeChannel,
    _messages: messages
  };

  return guild;
}

function createMockInteraction({
  guild,
  channel,
  user,
  isAdmin = false,
  commandName = null,
  subcommand = null,
  optionValues = {},
  customId = null,
  message = null,
  fieldValues = {}
}) {
  const perms = isAdmin
    ? new PermissionsBitField([PermissionsBitField.Flags.Administrator, PermissionsBitField.Flags.ManageGuild, PermissionsBitField.Flags.ManageChannels])
    : new PermissionsBitField([]);

  const interaction = {
    commandName,
    customId,
    user,
    member: { id: user.id, permissions: perms, roles: { cache: new MockCollection() } },
    memberPermissions: perms,
    guildId: guild.id,
    guild,
    channelId: channel.id,
    channel,
    client: guild.client,
    message,
    replied: false,
    deferred: false,
    replies: [],
    modals: [],
    inGuild: () => true,
    options: {
      getSubcommand: () => subcommand,
      getString: (k) => optionValues[k] ?? null,
      getInteger: (k) => optionValues[k] ?? null,
      getBoolean: (k) => optionValues[k] ?? null,
      getChannel: (k) => optionValues[k] ?? null,
      getRole: (k) => optionValues[k] ?? null,
      getUser: (k) => optionValues[k] ?? null
    },
    fields: {
      getTextInputValue: (k) => fieldValues[k]
    },
    reply: async (payload) => {
      interaction.replied = true;
      const entry = typeof payload === 'string' ? { content: payload } : payload;
      interaction.replies.push(entry);
      return entry;
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload) => {
      interaction.replied = true;
      const entry = typeof payload === 'string' ? { content: payload } : payload;
      interaction.replies.push(entry);
      return entry;
    },
    followUp: async (payload) => {
      const entry = typeof payload === 'string' ? { content: payload } : payload;
      interaction.replies.push(entry);
      return entry;
    },
    update: async (payload) => {
      interaction.replied = true;
      const entry = typeof payload === 'string' ? { content: payload } : payload;
      interaction.replies.push(entry);
      if (message) await message.edit(entry);
      return entry;
    },
    showModal: async (modal) => {
      interaction.replied = true;
      interaction.modals.push(modal);
      return modal;
    }
  };

  return interaction;
}

module.exports = {
  createMockGuild,
  createMockInteraction
};
