const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const casualManager = require('../managers/casualManager');

async function handleCasualButton(interaction) {
  const customId = interaction.customId;

  if (customId.startsWith('casual_join_')) {
    const lobbyId = parseInt(customId.replace('casual_join_', ''), 10);
    return await casualManager.handleJoinQueue(interaction, lobbyId);
  }

  if (customId.startsWith('casual_leave_')) {
    const lobbyId = parseInt(customId.replace('casual_leave_', ''), 10);
    return await casualManager.handleLeaveQueue(interaction, lobbyId);
  }

  if (customId.startsWith('casual_start_')) {
    const lobbyId = parseInt(customId.replace('casual_start_', ''), 10);
    return await casualManager.handleStartMatch(interaction, lobbyId);
  }

  if (customId.startsWith('casual_code_')) {
    const lobbyId = customId.replace('casual_code_', '');

    const modal = new ModalBuilder()
      .setCustomId(`casual_modal_code_${lobbyId}`)
      .setTitle('Enter OUAG Lobby Code');

    const codeInput = new TextInputBuilder()
      .setCustomId('lobby_code_input')
      .setLabel('4-Character Game Code')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 7X9K')
      .setMinLength(4)
      .setMaxLength(4)
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder().addComponents(codeInput);
    modal.addComponents(firstActionRow);

    return await interaction.showModal(modal);
  }
}

async function handleCasualModal(interaction) {
  const customId = interaction.customId;
  if (customId.startsWith('casual_modal_code_')) {
    const lobbyId = parseInt(customId.replace('casual_modal_code_', ''), 10);
    const code = interaction.fields.getTextInputValue('lobby_code_input');
    return await casualManager.handleSubmitCode(interaction, lobbyId, code);
  }
}

module.exports = {
  handleCasualButton,
  handleCasualModal
};
