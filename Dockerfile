FROM oven/bun:alpine AS base
WORKDIR /usr/src/app

# Copy package files and lockfile
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies like Prisma)
RUN bun install --frozen-lockfile

# Copy the rest of the project source
COPY . .

# Generate the Prisma client
RUN bunx prisma generate

# Compile/bundle the TypeScript code into a single minified JavaScript file
RUN bun build ./src/index.ts --outfile ./dist/index.js --target=bun

# Expose server port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Run database migrations and start the compiled bundle
CMD ["sh", "-c", "bunx prisma migrate deploy && bun dist/index.js"]
