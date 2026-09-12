# The desk is a long-running process, not a request handler: it ticks every few
# seconds whether or not anyone is watching, and holds the book in memory between
# ticks. That rules out serverless hosting — this image is meant for anything
# that keeps a container alive (Fly, Railway, Render, a VPS, a Raspberry Pi).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# The book lives here. Mount a volume on it or a restart loses every position.
ENV DATA_DIR=/data

RUN addgroup -g 1001 -S desk && adduser -u 1001 -S desk -G desk \
 && mkdir -p /data && chown desk:desk /data

COPY --from=build --chown=desk:desk /app/.next/standalone ./
COPY --from=build --chown=desk:desk /app/.next/static ./.next/static
COPY --from=build --chown=desk:desk /app/public ./public

USER desk
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/state').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
