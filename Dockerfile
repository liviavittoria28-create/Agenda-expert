
# Agenda Expert — imagem de produção
FROM node:24-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=America/Sao_Paulo

WORKDIR /app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências de produção
RUN npm ci --omit=dev

# Copia o código do aplicativo
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Diretório do banco e backups
RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "--disable-warning=ExperimentalWarning", "server/boot.js"]

