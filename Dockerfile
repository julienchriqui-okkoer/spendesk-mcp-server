# Build
FROM node:20-alpine AS build
WORKDIR /app
# Native deps for better-sqlite3 (node-gyp build)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Run HTTP server
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Native deps for better-sqlite3 (node-gyp build)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
CMD ["node", "dist/server-http.js"]
