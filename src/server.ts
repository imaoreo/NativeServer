import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { Redis } from 'ioredis';
import { setupWebSocket } from './websocket/index.js';
import apiRouter from './routes/api.js';
import { findChatMediaFile, findProfileMediaFile, isValidGrindrId, albumMediaPath } from './websocket/events/helper.js';
import { prisma } from './db.js';

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => console.log('Redis connection established.'));
redis.on('error', (err: any) => console.error('Redis connection error:', err));

app.use(express.json());

// Enable CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use('/api', apiRouter);

app.get('/health', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.json({ status: 'healthy' });
});

app.get('/public/cache/pfp/:file', async (req, res) => {
  const mediaHash = req.params.file.replace(/\.jpg$/, '');
  const media = await findProfileMediaFile(mediaHash);
  if (!media) {
    res.status(404).send('Not Found');
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.type(media.contentType);
  res.sendFile(path.resolve(media.filePath));
});

app.get('/public/cache/chat/:mediaHash', (req, res) => {
  const media = findChatMediaFile(req.params.mediaHash);
  if (!media) {
    res.status(404).send('Not Found');
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.type(media.contentType);
  res.sendFile(path.resolve(media.filePath));
});

app.get('/public/cache/albums/:albumId', async (req, res) => {
  const { albumId } = req.params;
  if (!isValidGrindrId(albumId)) {
    res.status(404).send('Not Found');
    return;
  }

  const items = await prisma.grindrAlbumMedia.findMany({
    where: { albumId },
    orderBy: { createdAt: 'asc' }
  });

  if (items.length === 0) {
    res.status(404).send('Not Found');
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    albumId,
    ownerProfileId: items[0].ownerProfileId,
    items: items.map(item => ({
      contentId: item.contentId,
      contentType: item.contentType,
      url: `/public/cache/albums/${albumId}/${item.contentId}`,
      createdAt: item.createdAt.getTime()
    }))
  });
});

app.get('/public/cache/albums/:albumId/:contentId', async (req, res) => {
  const { albumId, contentId } = req.params;
  if (!isValidGrindrId(albumId) || !isValidGrindrId(contentId)) {
    res.status(404).send('Not Found');
    return;
  }

  const item = await prisma.grindrAlbumMedia.findUnique({ where: { albumId_contentId: { albumId, contentId } } });
  if (!item) {
    res.status(404).send('Not Found');
    return;
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.type(item.contentType);
  res.sendFile(path.resolve(albumMediaPath(albumId, item.fileName)));
});

app.use((req, res) => {
  res.status(404).send('Not Found');
});

setupWebSocket(server, redis);

server.listen(PORT, () => {
  console.log(`Starting Native Server on port ${PORT}...`);
});
