const { PermissionsBitField } = require('discord.js');

/**
 * Checks if a user is a tournament coordinator or server administrator.
 */
function isCoordinator(member, tournament, interaction = null) {
  if (!member && !interaction) return false;

  if (interaction?.memberPermissions) {
    if (interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator) ||
        interaction.memberPermissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return true;
    }
  }

  if (member?.permissions) {
    try {
      const bitfield = typeof member.permissions.has === 'function'
        ? member.permissions
        : new PermissionsBitField(member.permissions);
      if (bitfield.has(PermissionsBitField.Flags.Administrator) || bitfield.has(PermissionsBitField.Flags.ManageGuild)) {
        return true;
      }
    } catch (e) {}
  }

  if (tournament?.coordinator_role_id) {
    if (member?.roles?.cache?.has(tournament.coordinator_role_id)) return true;
    if (Array.isArray(member?.roles) && member.roles.includes(tournament.coordinator_role_id)) return true;
  }
  return false;
}

module.exports = { isCoordinator };
