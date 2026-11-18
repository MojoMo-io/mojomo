# MojoMo — human oversight records for AI agents
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache postgresql-client bash
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web ./web
COPY migrations ./migrations
COPY scripts ./scripts
EXPOSE 8002
CMD ["node", "dist/server.js"]
