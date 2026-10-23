FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public
RUN apk add --no-cache git && mkdir -p /app/data /app/uploads
ENV NODE_ENV=production PORT=3002
EXPOSE 3002
VOLUME ["/app/data", "/app/uploads"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:3002/api/health || exit 1
CMD ["node", "server.js"]
