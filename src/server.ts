import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { Redis } from 'ioredis';
import { runMigrations } from './db.js';
import { setupWebSocket } from './websocket/index.js';
import { DiscordBot } from './discord/index.js';

const PORT = process.env.PORT || 3000;
const CACHE_DIR = process.env.CACHE_DIR || './public/cache';

const app = express();
const server = http.createServer(app);

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => console.log('Redis connection established.'));
redis.on('error', (err: any) => console.error('Redis connection error:', err));

runMigrations()
  .then(() => console.log('Database connection and tables initialized.'))
  .catch((err: any) => {
    console.error('Database initialization failed:', err);
    process.exit(1);
  });

app.use(express.json());

app.get('/health', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.json({ status: 'healthy' });
});

app.use('/public/cache', express.static(path.resolve(CACHE_DIR), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

app.use((req, res) => {
  res.status(404).send('Not Found');
});

setupWebSocket(server, redis);

const discordToken = process.env.DISCORD_BOT_TOKEN;
const discordGuildId = process.env.DISCORD_GUILD_ID || '';
const discordReviewChannelId = process.env.DISCORD_REVIEW_CHANNEL_ID || '';

if (discordToken && discordToken !== 'your_discord_bot_token_here') {
  if (!discordReviewChannelId || discordReviewChannelId === 'your_discord_review_channel_id_here') {
    console.warn('DISCORD_REVIEW_CHANNEL_ID is required to start Discord Bot');
  } else {
    const bot = new DiscordBot(discordToken, discordGuildId, discordReviewChannelId);
    bot.start().catch((err: any) => {
      console.error('Failed to start Discord bot:', err);
    });
  }
} else {
  console.log('DISCORD_BOT_TOKEN not provided, skipping Discord Bot startup');
}

// Start HTTP/WS Server
server.listen(PORT, () => {
  console.log(`Starting Native Server on port ${PORT}...`);
});
