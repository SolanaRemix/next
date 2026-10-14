FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY . .
RUN npm ci --include=dev \
  && npm run db:generate --workspace @next/api \
  && npm run build --workspace @next/api \
  && npm cache clean --force

EXPOSE 3001

CMD ["sh", "-c", "npm run db:migrate --workspace @next/api && npm run start --workspace @next/api"]
