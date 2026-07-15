import 'dotenv/config';
import express from 'express';
import http from 'http';
// import path from 'path';
import { Redis } from 'ioredis';
import { setupWebSocket } from './websocket/index.js';

const PORT = process.env.PORT || 3000;
// const CACHE_DIR = process.env.CACHE_DIR || './public/cache';

const app = express();
const server = http.createServer(app);

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

redis.on('connect', () => console.log('Redis connection established.'));
redis.on('error', (err: any) => console.error('Redis connection error:', err));

app.use(express.json());

app.get('/health', (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.json({ status: 'healthy' });
});

/*
app.use('/public/cache', express.static(path.resolve(CACHE_DIR), {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));
*/

app.use((req, res) => {
  res.status(404).send('Not Found');
});

setupWebSocket(server, redis);

server.listen(PORT, () => {
  console.log(`Starting Native Server on port ${PORT}...`);
});
