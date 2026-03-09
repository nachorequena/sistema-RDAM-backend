# Multi-stage Dockerfile for NestJS app
FROM node:20-bullseye-slim AS builder
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates openssl \
	&& rm -rf /var/lib/apt/lists/* \
	&& if [ -f package-lock.json ]; then \
			npm ci --no-audit --prefer-offline; \
		else \
			npm install --no-audit; \
		fi

# Copy source and build
COPY tsconfig.json prisma ./
COPY src ./src
COPY prisma ./prisma

# Generar cliente Prisma antes de compilar (necesario para @prisma/client)
RUN npx prisma generate

RUN npm run build

# Production image
FROM node:20-bullseye-slim AS runner
WORKDIR /app

ENV NODE_ENV=production

# Instalar Chrome y dependencias necesarias para Puppeteer
RUN apt-get update && apt-get install -y --no-install-recommends --fix-missing \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Decirle a Puppeteer que use el Chromium del sistema (no descargue el suyo)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy only what we need from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./package.json
COPY prisma ./prisma

EXPOSE 3001
CMD ["npm", "run", "start:prod"]