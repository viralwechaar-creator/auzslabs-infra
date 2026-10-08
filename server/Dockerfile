FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache fontconfig ttf-dejavu su-exec && npm install --omit=dev
COPY src ./src
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
