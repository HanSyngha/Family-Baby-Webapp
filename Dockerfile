FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build:client && npm run build:server

# ---

FROM node:20-alpine

RUN apk add --no-cache ffmpeg intel-media-driver

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 2290
CMD ["node", "dist/server/index.js"]
