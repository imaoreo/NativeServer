import { 
  ButtonInteraction, 
  Client, 
  EmbedBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ActionRowBuilder, 
  TextChannel 
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import { 
  getCompanionDeviceCountByDiscordId, 
  saveCompanionDevice 
} from '../../db.js';

export async function handleButtonInteraction(
  interaction: ButtonInteraction, 
  client: Client, 
  reviewChannelId: string
): Promise<void> {
  const customId = interaction.customId;
  const adminUser = interaction.user;

  if (customId.startsWith('approve_mac_')) {
    const discordId = customId.replace('approve_mac_', '');
    
    const count = await getCompanionDeviceCountByDiscordId(discordId);
    if (count >= 4) {
      const originalMessageId = interaction.message.id;
      const forceBtn = new ButtonBuilder()
        .setLabel('Force Approve')
        .setStyle(ButtonStyle.Success)
        .setCustomId(`force_approve_mac_${discordId}_${originalMessageId}`);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(forceBtn);
      await interaction.reply({
        content: `⚠️ User <@${discordId}> already has ${count} companion devices linked (maximum limit is 4). Do you want to force override?`,
        components: [row],
        ephemeral: true
      });
      return;
    }

    const apiKey = `ng_mac_${uuidv4()}`;
    await saveCompanionDevice('', discordId, apiKey, 'discord_manual_key', false);

    try {
      const targetUser = await client.users.fetch(discordId);
      await targetUser.send(`Hello! Your manual API key application has been **APPROVED**.\n\nHere is your unique API Key:\n\`\`\`\n${apiKey}\n\`\`\`\n*Please copy this key into your app to link it. This key consumes 1 of your 4 companion device slots.*`);
    } catch (err) {
      console.error(`Failed to DM user ${discordId}:`, err);
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x2ecc71) // Green
      .addFields({ name: 'Status', value: `Approved by <@${adminUser.id}>`, inline: false });

    await interaction.update({
      embeds: [embed],
      components: []
    });
  }

  if (customId.startsWith('force_approve_mac_')) {
    const payload = customId.replace('force_approve_mac_', '');
    const parts = payload.split('_');
    if (parts.length < 2) return;
    
    const discordId = parts[0];
    const originalMessageId = parts[1];

    const apiKey = `ng_mac_force_${uuidv4()}`;
    await saveCompanionDevice('', discordId, apiKey, 'discord_manual_key', true);

    try {
      const targetUser = await client.users.fetch(discordId);
      await targetUser.send(`Hello! Your manual API key application has been **APPROVED** (Override Edition).\n\nHere is your unique API Key:\n\`\`\`\n${apiKey}\n\`\`\`\n*Please copy this key into your app to link it. This key bypasses your companion limit.*`);
    } catch (err) {
      console.error(`Failed to DM user ${discordId}:`, err);
    }

    // Edit original staff review message
    try {
      const reviewChannel = await client.channels.fetch(reviewChannelId) as TextChannel;
      const originalMsg = await reviewChannel.messages.fetch(originalMessageId);
      if (originalMsg && originalMsg.embeds.length > 0) {
        const embed = EmbedBuilder.from(originalMsg.embeds[0])
          .setColor(0x9b59b6) // Purple
          .addFields({ name: 'Status', value: `Approved (Override) by <@${adminUser.id}>`, inline: false });

        await originalMsg.edit({
          embeds: [embed],
          components: []
        });
      }
    } catch (err) {
      console.error('Failed to edit original message:', err);
    }

    await interaction.update({
      content: `✅ Force override approved for <@${discordId}>.`,
      components: []
    });
  }

  if (customId.startsWith('reject_mac_')) {
    const discordId = customId.replace('reject_mac_', '');

    try {
      const targetUser = await client.users.fetch(discordId);
      await targetUser.send(`Hello. Your API key application has been reviewed and rejected by the admin team.`);
    } catch (err) {
      console.error(`Failed to DM user ${discordId}:`, err);
    }

    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xe74c3c) // Red
      .addFields({ name: 'Status', value: `Rejected by <@${adminUser.id}>`, inline: false });

    await interaction.update({
      embeds: [embed],
      components: []
    });
  }
}
