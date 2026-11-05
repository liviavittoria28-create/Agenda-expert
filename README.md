# Agenda Expert

Agenda, clientes, anamnese, catálogo e financeiro do estúdio **Esther Lino Bio Estética**.
É um PWA (Progressive Web App) que se instala no iPhone pelo Safari, sem App Store nem a taxa anual da Apple Developer.

- **Back-end:** Node.js 22.13 ou mais novo, com API própria.
- **Banco de dados:** Postgres no **Supabase**, online e gratuito, pela variável `DATABASE_URL`. As tabelas estão em [`supabase/schema.sql`](supabase/schema.sql). Sem `DATABASE_URL`, o app usa um Postgres embutido (PGlite) gravado em `data/`, para rodar no computador e nos testes.
- **Front-end:** HTML, CSS e JavaScript puro, pensado primeiro para o celular e com service worker para uso offline.
- **Visual:** tons de marfim, dourado e marrom, com as fontes Cormorant Garamond (títulos) e Manrope (textos).

## Como rodar

```bash
cp .env.example .env      # defina ADMIN_EMAIL, ADMIN_PASSWORD (e DATABASE_URL para usar o Supabase)
npm install
npm start                 # http://localhost:5173
```

O acesso vem **sempre** das variáveis `ADMIN_EMAIL` e `ADMIN_PASSWORD` (no `.env` em casa, ou nas variáveis do servidor na hospedagem). Para trocar o e-mail ou a senha, mude as variáveis e reinicie o app; as sessões abertas são encerradas. A senha precisa ter pelo menos 8 caracteres. Em produção, sem isso o app não sobe.

O app começa vazio, só com os 9 procedimentos do catálogo.

## Robô de confirmação pelo WhatsApp

Fica em **Mais → WhatsApp** e é gratuito: conecta o WhatsApp do estúdio como se fosse um WhatsApp Web.

1. **Conectar.** Se o app estiver aberto no computador, escaneie o QR code com o celular. No próprio iPhone, use **Conectar com número** e digite o código de 8 letras em WhatsApp → Aparelhos conectados → **Conectar com número de telefone**.
2. **Envio automático.** Ligue a opção e escolha quando enviar (**no dia** ou **na véspera**) e a partir de que horário. O robô manda a mensagem de confirmação para cada atendimento "Agendada", uma vez só, com pausas de 8 a 18 segundos entre uma mensagem e outra.
3. **Respostas.**
   - Se a cliente responder **1**, "confirmo", "sim"…, o atendimento vira **Confirmada** e o robô agradece.
   - Se responder **2**, "remarcar", "não posso"…, o atendimento ganha o aviso **Pediu para remarcar** e o robô avisa que você vai chamar.
   - Qualquer outra mensagem fica para você responder; o robô não se mete na conversa.
4. **Todas as mensagens** (confirmação, instruções e respostas) podem ser editadas nessa tela, com prévia.

**Tutorial em vídeo:** em `/tutorial/` há um vídeo animado de como conectar só com o código e de como o robô funciona, além do passo a passo com prints. Ele também abre pelo botão **▶ Tutorial** em Mais → WhatsApp. Se as telas mudarem, gere os prints de novo com o app rodando (`PRINT_EMAIL=... PRINT_PASSWORD=... npm run prints -- http://localhost:5173`); o comando usa o Edge ou o Chrome sem abrir janela.

**Limites:**
- **Sem botões.** O WhatsApp só permite botões clicáveis na API oficial e paga da Meta; por isso a cliente responde com números.
- **Uso não oficial.** A conexão usa a biblioteca [Baileys](https://github.com/WhiskeySockets/Baileys). O WhatsApp pode restringir números que mandam muitas mensagens, então use com moderação.
- **Sessão guardada no banco.** A conexão fica salva no banco (tabela `wa_auth`) e volta sozinha quando o servidor reinicia. Para desligar o robô no servidor, defina `WHATSAPP=0`.

## Testes automáticos

```bash
npm test
```

```bash
npm run test:postgres
```

São 81 testes, que rodam num banco temporário sem mexer nos seus dados. O `test:postgres` roda os testes da API conectando por `DATABASE_URL`, pelo protocolo de rede do Postgres, do mesmo jeito que o app conecta no Supabase. Eles cobrem:

- login e sessão, incluindo o limite de tentativas;
- clientes e anamnese;
- catálogo;
- agendamentos: conflitos, bloqueios, status, avisos (RN12, RN13) e preço congelado (RN08);
- financeiro e exportação em CSV;
- estoque e backup;
- robô do WhatsApp, com um WhatsApp simulado: envio, respostas, "9" extra do celular e envio automático;
- segurança: CSRF, acesso a arquivos fora da pasta pública e XSS;
- PWA;
- desempenho com 5.000 clientes e cerca de 25 mil atendimentos.

## Testar no celular (mesma rede Wi-Fi)

1. No computador, rode `npm start`.
2. Descubra o IP do computador: rode `ipconfig` e procure o "Endereço IPv4" do Wi-Fi, por exemplo `192.168.15.14`.
3. No celular, conectado ao **mesmo Wi-Fi**, abra `http://192.168.15.14:5173` no Safari.
4. Se não abrir, o Firewall do Windows está bloqueando. Na janela do firewall, permita o **Node.js** em redes privadas e marque o seu Wi-Fi como rede **Privada**.

Nesse modo, sem HTTPS, o app funciona normalmente, mas a consulta offline e a instalação completa só funcionam depois de publicado com HTTPS (veja [DEPLOY.md](DEPLOY.md)).

## Instalar no iPhone

1. Abra o endereço do app no **Safari**.
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

O app ganha ícone próprio e abre em tela cheia.

## Banco de dados online (Supabase)

Os dados ficam no **Supabase**, um Postgres online e gratuito. Clientes, agendamentos, anamneses, financeiro, estoque, ajustes e a conexão do WhatsApp **ficam sempre salvos**, mesmo que o servidor do Render reinicie ou "durma".

- **Conexão:** o app conecta pela `DATABASE_URL` (Supabase → **Connect → Session pooler**) e cria as tabelas sozinho na primeira vez.
- **Segurança:** as tabelas têm **RLS ligado e nenhuma política**. Assim, a API pública do Supabase não expõe nada; só o servidor do app acessa.
- **Aviso:** se o app estiver hospedado **sem** `DATABASE_URL`, aparece um **aviso vermelho** em todas as telas.

O passo a passo está em [DEPLOY.md](DEPLOY.md).

## Cópias de segurança (RNF07)

- O Supabase guarda o banco online.
- No app, em **Mais → Baixar cópia de segurança**, sai um arquivo JSON com todos os dados.
- O servidor também grava uma cópia JSON por dia em `data/backups/` (as últimas 30). Para listar: `npm run backups`.
- Para restaurar uma cópia, com a `DATABASE_URL` certa no `.env`: `npm run restaurar -- arquivo.json`. Isso **substitui** os dados atuais.

## Hospedagem (RSIS03)

O passo a passo para publicar com **Supabase + GitHub + Render** está em [DEPLOY.md](DEPLOY.md). O `render.yaml` já está pronto para o plano Free, porque os dados ficam no Supabase.

Em produção, com `NODE_ENV=production`, o servidor liga o cookie `Secure`, o HSTS e a leitura do IP real atrás do proxy. Ele também responde em `/api/health` para o Render verificar se está no ar. A versão do service worker é gerada automaticamente a cada mudança nos arquivos, então os aparelhos se atualizam sozinhos.

## Mapa dos requisitos

| Requisito | Onde está |
|---|---|
| RF01 e RNF06: login com senha em hash (scrypt) e sessão HttpOnly | `server/auth.js`, `views/login.js` |
| RF03 a RF07, RN13 e RN14: clientes, busca, anamnese, termo e inativação | `views/clients.js`, `/api/clients` |
| RSIS02: banco de dados relacional (Postgres/Supabase) | `supabase/schema.sql`, `server/db.js` |
| RF08, RF09 e RN08: catálogo com os 9 procedimentos e preço congelado no agendamento | `server/db.js`, `views/procedures.js` |
| RF10 a RF15 e RN02 a RN07: agendamento, término automático, conflitos, status e motivo | `views/appointment.js`, `/api/appointments` |
| RN12: aviso de manutenção de cílios antes de 20 dias | `softWarnings` em `server/api.js` |
| RF16 a RF18: visões dia, semana, mês e ano com cores por status | `views/agenda.js` |
| RF19 e RF20: bloqueios de dia inteiro ou de horário | `openBlockForm`, **Mais → Bloqueios** |
| RF21 a RF25, RN09 a RN11: financeiro mensal, filtros e entrada ao concluir | `views/finance.js` |
| RF27: exportação em planilha (CSV para Excel) e PDF pela impressão | botões **Planilha** e **PDF** |
| RF28: estoque de materiais (desejável) | **Mais → Estoque** |
| RNF08: consulta offline da agenda | `public/sw.js` |
| RNF09: pt-BR, R$, dd/mm/aaaa e horário de Brasília | `server/time.js`, `public/js/ui.js` |

## Pontos a confirmar com a Esther (Anexo B)

- **Duração real de cada procedimento.** As atuais são estimativas e podem ser editadas no app.
- **Horário de funcionamento, dias de atendimento e intervalo entre clientes.** Ficam em **Mais → Ajustes**; por enquanto estão 08:00–20:00, de segunda a sábado.
- **Texto do termo de consentimento.** Também editável em Ajustes.
- **Categorias financeiras e formas de pagamento.** Ficam em `CATEGORIES` e `METHODS`, no arquivo `server/api.js`.
- **O que "estoque" quer dizer.** O controle de materiais já está pronto, caso seja isso.
