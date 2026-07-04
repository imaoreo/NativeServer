# Build stage
FROM node:26-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run stage
FROM node:26-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/db/migrations ./db/migrations

EXPOSE 3000
ENV PORT=3000
ENV CACHE_DIR=/usr/src/app/public/cache

CMD ["node", "dist/server.js"]
