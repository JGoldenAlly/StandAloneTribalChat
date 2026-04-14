FROM node:20-alpine

WORKDIR /app

# Install dependencies (layer cache: copy manifests first)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application source
COPY server.js ./
COPY public/ ./public/

# Create the session data directory
RUN mkdir -p /app/data

EXPOSE 3000

# Health check — wget is available in Alpine
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
