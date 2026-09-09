FROM node:22-slim AS build

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

FROM node:22-slim

WORKDIR /app

COPY --from=build /app .

EXPOSE 3001

CMD ["node", "index.js"]
