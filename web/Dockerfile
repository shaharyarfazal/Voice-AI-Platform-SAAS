FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Call recordings (a named volume in docker-compose.yml; created here so it is owned by "node").
RUN mkdir -p /data/recordings && chown node:node /data/recordings
ENV RECORDINGS_DIR=/data/recordings
USER node
CMD ["node", "server.js"]
