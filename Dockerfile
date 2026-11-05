# Agenda Expert — imagem de produção (sem dependências npm)
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=America/Sao_Paulo

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# o banco e os backups ficam no volume persistente montado em /data
# (o volume do Fly é montado como root, por isso o processo roda como root dentro da VM isolada)
RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
