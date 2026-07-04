import { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  Interaction, 
  CacheType 
} from 'discord.js';
import { handleApplyApiKeyCommand } from './commands/applyApiKey.js';
import { handleApplyApiModalSubmit } from './interactions/modalSubmit.js';
import { handleButtonInteraction } from './interactions/buttons.js';

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
        if (interaction.commandName === 'apply-api-key') {
          await handleApplyApiKeyCommand(interaction);
        }
      } else if (interaction.isModalSubmit()) {
        if (interaction.customId === 'apply_api_modal') {
          await handleApplyApiModalSubmit(interaction, this.client, this.reviewChannelId);
        }
      } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction, this.client, this.reviewChannelId);
      }
    } catch (err) {
      console.error('Error handling interaction:', err);
    }
  }
}
