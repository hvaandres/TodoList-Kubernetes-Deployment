FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:app

FROM node:22-alpine
WORKDIR /app
# Production serves static files using Node built-ins; package managers are unnecessary.
RUN rm -rf /usr/local/lib/node_modules /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg /usr/local/bin/corepack
COPY --from=build /app/build ./build
COPY server.js ./
ENV NODE_ENV=production
USER node
EXPOSE 3000 
CMD ["node", "server.js"]
