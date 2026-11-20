FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev && npm i tsx --no-save
COPY --from=build /app/dist ./dist
COPY src ./src
COPY tsconfig.server.json ./
VOLUME /data
EXPOSE 8787
HEALTHCHECK CMD node -e "fetch('http://localhost:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "--tsconfig", "tsconfig.server.json", "src/server/index.ts"]
