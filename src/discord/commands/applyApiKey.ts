import { 
  ChatInputCommandInteraction, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder 
} from 'discord.js';

export async function handleApplyApiKeyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const modal = new ModalBuilder()
    .setCustomId('apply_api_modal')
    .setTitle('API Key Application');

  const reasonInput = new TextInputBuilder()
    .setCustomId('reason_input')
    .setLabel('Why do you need API access?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Please explain here...');

  const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}
