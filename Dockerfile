FROM oven/bun:alpine AS base
WORKDIR /usr/src/app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

COPY . .

RUN bunx prisma generate

RUN bun build ./src/index.ts --outfile ./dist/index.js --target=bun

EXPOSE 3000

ENV NODE_ENV=production

CMD ["sh", "-c", "bunx prisma migrate deploy && bun dist/index.js"]
