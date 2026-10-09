FROM node:22-alpine AS build

WORKDIR /app
COPY . .
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm ci && npm run build --workspace @next/web

FROM nginxinc/nginx-unprivileged:stable-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
