FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
# Table setup (and, for the gateway, the admin account) so a Docker Compose stack can run them as one-shot jobs
COPY scripts ./scripts
COPY db ./db
ENV NODE_ENV=production
EXPOSE 3003
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3003/health || exit 1
CMD ["node", "src/server.js"]
