import { 
  Client, 
  GatewayIntentBits
} from 'discord.js';

export class DiscordBot {
  private token: string;
  private client: Client;

  constructor(token: string) {
    this.token = token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages
      ]
    });
  }

  async start(): Promise<void> {
    await this.client.login(this.token);
    console.log('Discord Bot is now running...');
  }

  async stop(): Promise<void> {
    await this.client.destroy();
  }
}
