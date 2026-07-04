import { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  REST,
  Routes,
  Interaction,
  CacheType,
  TextChannel
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import { 
  getCompanionDeviceCountByDiscordId, 
  saveCompanionDevice 
} from './db.js';

export class DiscordBot {
  private token: string;
  private guildId: string;
  private reviewChannelId: string;
  private client: Client;

  constructor(token: string, guildId: string, reviewChannelId: string) {
    this.token = token;
    this.guildId = guildId;
    this.reviewChannelId = reviewChannelId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
      ]
    });

    this.client.on('interactionCreate', this.handleInteraction.bind(this));
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
    console.log('Discord Bot is now running...');
    await this.registerSlashCommands();
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }

  async registerSlashCommands(): Promise<void> {
    const commands = [
      {
        name: 'apply-api-key',
        description: 'Apply for an API Key'
      }
    ];

    const rest = new REST({ version: '10' }).setToken(this.token);
    try {
      console.log('Started refreshing application (/) commands.');
      if (this.client.user) {
        await rest.put(
          Routes.applicationGuildCommands(this.client.user.id, this.guildId),
          { body: commands }
        );
        console.log('Successfully reloaded application (/) commands.');
      }
    } catch (error) {
      console.error('Error registering slash commands:', error);
    }
  }

  async handleInteraction(interaction: Interaction<CacheType>): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalSubmit(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      }
    } catch (err) {
      console.error('Error handling interaction:', err);
    }
  }

  async handleSlashCommand(interaction: any): Promise<void> {
    if (interaction.commandName === 'apply-api-key') {
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
  }

  async handleModalSubmit(interaction: any): Promise<void> {
    if (interaction.customId === 'apply_api_modal') {
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

      const reviewChannel = await this.client.channels.fetch(this.reviewChannelId) as TextChannel;
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
  }

  async handleButtonInteraction(interaction: any): Promise<void> {
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
        const targetUser = await this.client.users.fetch(discordId);
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
        const targetUser = await this.client.users.fetch(discordId);
        await targetUser.send(`Hello! Your manual API key application has been **APPROVED** (Override Edition).\n\nHere is your unique API Key:\n\`\`\`\n${apiKey}\n\`\`\`\n*Please copy this key into your app to link it. This key bypasses your companion limit.*`);
      } catch (err) {
        console.error(`Failed to DM user ${discordId}:`, err);
      }

      try {
        const reviewChannel = await this.client.channels.fetch(this.reviewChannelId) as TextChannel;
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
        const targetUser = await this.client.users.fetch(discordId);
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
}
