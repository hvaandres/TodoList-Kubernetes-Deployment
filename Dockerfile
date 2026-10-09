FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:app

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/build ./build
COPY server.js ./
ENV NODE_ENV=production
EXPOSE 3000 
CMD ["node", "server.js"]
