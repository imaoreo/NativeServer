import { 
  ModalSubmitInteraction, 
  Client, 
  EmbedBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder, 
  TextChannel 
} from 'discord.js';

export async function handleApplyApiModalSubmit(
  interaction: ModalSubmitInteraction, 
  client: Client, 
  reviewChannelId: string
): Promise<void> {
  const reason = interaction.fields.getTextInputValue('reason_input');
  const user = interaction.user;

  const embed = new EmbedBuilder()
    .setTitle('API Key Application')
    .setColor(0x3498db) // Blue
    .setDescription('A user has applied for a manual API key.')
    .addFields(
      { name: 'User', value: `<@${user.id}>`, inline: true },
      { name: 'Discord ID', value: user.id, inline: true },
      { name: 'Reason', value: reason, inline: false }
    );

  const approveBtn = new ButtonBuilder()
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success)
    .setCustomId(`approve_mac_${user.id}`);

  const rejectBtn = new ButtonBuilder()
    .setLabel('Reject')
    .setStyle(ButtonStyle.Danger)
    .setCustomId(`reject_mac_${user.id}`);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rejectBtn);

  const reviewChannel = await client.channels.fetch(reviewChannelId) as TextChannel;
  if (!reviewChannel) {
    console.error('Review channel not found');
    return;
  }

  await reviewChannel.send({ embeds: [embed], components: [row] });

  await interaction.reply({
    content: 'Your application has been submitted successfully to the admins for review! You will receive a DM once processed.',
    ephemeral: true
  });
}
