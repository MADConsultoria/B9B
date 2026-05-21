FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY calendar.js ./
COPY index.html ./
COPY inserir.html ./
COPY evento.html ./
COPY styles.css ./
COPY logo-liga-horizontal.png ./
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
