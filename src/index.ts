import { PrismaClient } from '@prisma/client';
import { join } from 'path';
import { RedisClient } from 'bun';

const prisma = new PrismaClient();

const redis = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");

const PORT = Number(process.env.PORT) || 3000;
const CACHE_DIR = join(import.meta.dir, '../public/cache');

console.log(`Starting Native Server on port ${PORT}...`);

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Pictures etc
    if (url.pathname.startsWith('/public/cache/')) {
      const fileName = url.pathname.replace('/public/cache/', '');
      
      const filePath = join(CACHE_DIR, fileName);

      // Make sure it is inside the Cache Folder
      if (!filePath.startsWith(CACHE_DIR)) {
        return new Response('Forbidden', { status: 403 });
      }

      const file = Bun.file(filePath);

      if (!(await file.exists())) {
        return new Response('Image not found', { status: 404 });
      }

      return new Response(file, {
        headers: {
          'Cache-Control': 'public, max-age=604800, immutable',
          'Content-Type': file.type || 'application/octet-stream', 
          'X-Content-Type-Options': 'nosniff'
        },
      });
    }

    // QR Code System
    if (url.pathname === '/api/v1/auth/qr-init' && req.method === 'POST') {
      try {
        const { placeholderDeviceId } = await req.json() as { placeholderDeviceId: string };
        
        if (!placeholderDeviceId) {
          return Response.json({ error: 'Missing deviceId' }, { status: 400 });
        }

        // Generate a random high-entropy temporary handshake token using Bun's native crypto module
        const handshakeToken = crypto.randomUUID();
        
        // Save to Redis with a strict 5-minute (300s) Time-To-Live using native Bun.redis
        await redis.setex(`handshake:${handshakeToken}`, 300, placeholderDeviceId);

        return Response.json({ 
          token: handshakeToken, 
          expiresIn: 300,
          instructions: "Render this token as a QR code or numeric string on the client app." 
        });
      } catch (err) {
        return Response.json({ error: 'Invalid JSON payload' }, { status: 400 });
      }
    }

    // Health Route
    if (url.pathname === '/health') {
      return Response.json({ status: 'healthy', runtime: 'Native Grind' });
    }

    return new Response('Not Found', { status: 404 });
  },
  
  error(error) {
    console.error('Server error:', error);
    return new Response(`An error occurred: ${error.message}`, { status: 500 });
  },
});