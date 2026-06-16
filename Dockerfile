FROM node:22-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 5175
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5175/ >/dev/null || exit 1

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5175"]
