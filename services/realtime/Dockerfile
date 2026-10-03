FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/lib ./src/lib
COPY services/realtime ./services/realtime
ENV WS_PORT=3001
EXPOSE 3001
CMD ["npx", "tsx", "services/realtime/server.ts"]
