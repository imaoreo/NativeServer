# Database & Cache Update Guide

This guide explains how to update the PostgreSQL database schema using Prisma migrations and how to interact with the Redis cache in this project.

---

## 1. Updating the PostgreSQL Schema (Prisma Migrations)

We use **Prisma Migrations** to manage schema changes in a structured, SQL-backed manner.

### Step 1: Modify the Schema
Open the Prisma schema file at [prisma/schema.prisma](file:///Users/jaybr/srv/projects/NativeServer/prisma/schema.prisma) and make your changes (e.g., adding a new model or updating fields):

```prisma
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}

// Example of a new model:
model Device {
  id        String   @id @default(uuid())
  deviceId  String   @unique
  createdAt DateTime @default(now())
}
```

### Step 2: Create and Apply the Migration Locally
With the local PostgreSQL container running (via `docker compose up -d postgres`), generate the SQL migration files by running:

```bash
DATABASE_URL="postgresql://grind_user:secure_password123@localhost:5432/grind_db?schema=public" bunx prisma migrate dev --name <migration_name>
```
*Replace `<migration_name>` with a short snake_case description of your change (e.g., `add_device_model`).*

**What this command does:**
1. Compares your `schema.prisma` with the current state of your local database.
2. Generates a new SQL migration script inside `prisma/migrations/`.
3. Applies that SQL script to your local database.
4. Regenerates the TypeScript types for `@prisma/client`.

### Step 3: Commit Migration Files
Always commit the generated folder under `prisma/migrations/` to version control (e.g., Git) so other environments can apply the exact same migrations.

### Step 4: Deploying to Production / Docker Containers
When the Docker container starts up, it automatically runs the migration deploy step defined in the [Dockerfile](file:///Users/jaybr/srv/projects/NativeServer/Dockerfile):

```bash
bunx prisma migrate deploy
```
This is fully non-interactive and applies any new SQL migration files that have not yet been run on the production database.

---

## 2. Using & Updating Redis

We use Bun's native high-performance Redis client (`RedisClient`).

### Configuration
The Redis client is instantiated in [src/index.ts](file:///Users/jaybr/srv/projects/NativeServer/src/index.ts) using the environment variable `REDIS_URL`, falling back to `localhost` if unset:

```typescript
const redis = new RedisClient(process.env.REDIS_URL || "redis://localhost:6379");
```

### Interacting with Redis in Code
Here are the common commands to write, update, or read cache keys:

```typescript
// 1. Set a standard key-value pair
await redis.set("my-key", "some-value");

// 2. Set a key with an expiration Time-To-Live (TTL) in seconds (e.g., 5 minutes / 300 seconds)
await redis.setex("handshake:token_123", 300, "device_id_abc");

// 3. Retrieve a value
const value = await redis.get("handshake:token_123");

// 4. Delete a key
await redis.del("my-key");
```

---

## 3. Useful Commands Quick Reference

| Action | Command |
| :--- | :--- |
| **Start DB & Redis Containers** | `docker compose up -d postgres redis` |
| **Stop All Containers** | `docker compose down` |
| **Create Local Migration** | `DATABASE_URL="postgresql://grind_user:secure_password123@localhost:5432/grind_db?schema=public" bunx prisma migrate dev --name <name>` |
| **Rebuild & Run App Container** | `docker compose up -d --build` |
| **View Database GUI (Studio)** | `DATABASE_URL="postgresql://grind_user:secure_password123@localhost:5432/grind_db?schema=public" bunx prisma studio` |
