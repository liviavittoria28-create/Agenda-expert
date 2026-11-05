# Publicar o Agenda Expert (Supabase + GitHub + Render)

- **Supabase:** guarda o **banco de dados** online, de graça. Clientes, agendamentos, financeiro e a conexão do WhatsApp ficam lá, **sempre salvos**.
- **GitHub:** guarda o código do app.
- **Render:** roda o app num endereço **https://…**, que a Esther instala no iPhone.

---

## 1. Criar o banco de dados no Supabase

1. Entre em <https://supabase.com> e crie uma conta (pode ser com o GitHub).
2. Clique em **New project** e preencha:
   - **Name:** `agenda-expert`
   - **Database Password:** clique em **Generate a password** e **copie e guarde** essa senha. Ela vai ser usada no passo 3.
   - **Region:** **South America (São Paulo)**
   - **Plan:** Free
3. Clique em **Create new project** e espere uns 2 minutos.

### Criar as tabelas

O app cria as tabelas sozinho na primeira vez que liga. Se preferir criar antes ou conferir:

1. No Supabase, abra **SQL Editor → New query**.
2. Cole todo o conteúdo do arquivo [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**.

Pode rodar quantas vezes quiser: ele **não apaga nada**.

> 🔒 **Segurança (LGPD):** o arquivo liga a proteção **RLS** em todas as tabelas. Com ela, os dados **não ficam acessíveis pela API pública** do Supabase, nem com a chave "anon". Só o servidor do app lê e grava. Por isso o app **não usa** as chaves `anon`/`service_role`: ele usa só a connection string do passo 3.

### Pegar a connection string

1. No topo do projeto no Supabase, clique em **Connect**.
2. Escolha **Connection string → Session pooler**. O pooler é necessário porque o Render só usa IPv4.
3. Copie o endereço. Ele é parecido com este:
   ```
   postgresql://postgres.abcdefghijk:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```
4. Troque `[YOUR-PASSWORD]` pela senha do banco que você guardou no passo 2. Tire também os colchetes.

> Se a senha tiver símbolos como `@ # / ? %`, gere outra só com letras e números em **Project Settings → Database → Reset database password**. Esses símbolos atrapalham o endereço.

**Não mande essa connection string para ninguém, nem no chat.** Ela vai direto no Render, no passo 3.

---

## 2. Subir o código para o GitHub

O repositório deve ser **privado**. O `.gitignore` já impede que o `.env` (com senhas) e a pasta `data/` sejam enviados.

### Com o GitHub Desktop (mais fácil)

1. **File → Add local repository** e escolha a pasta do projeto.
2. Escreva uma mensagem, como "Banco de dados Supabase", e clique em **Commit to main**.
3. Clique em **Publish repository** (ou **Push origin**, se já tinha publicado) e deixe **Keep this code private** marcado.

### Pelo terminal

```bash
git add .
```

```bash
git commit -m "Banco de dados Supabase"
```

```bash
git push
```

---

## 3. Criar o serviço no Render

1. Entre em <https://dashboard.render.com> com a sua conta do GitHub.
2. Clique em **New + → Blueprint** e escolha o repositório **agenda-expert**. O Render lê o `render.yaml` sozinho.
3. Ele vai pedir três variáveis:

| Variável | Valor |
|---|---|
| `ADMIN_EMAIL` | o e-mail de acesso da Esther |
| `ADMIN_PASSWORD` | uma senha forte, com pelo menos 8 caracteres |
| `DATABASE_URL` | a **connection string** do Supabase (passo 1) |

4. Clique em **Apply**.

> **Já tinha criado o serviço antes?** Abra o serviço no Render, vá em **Environment**, adicione `DATABASE_URL` e clique em **Save Changes**. Se você usa Docker, o `Dockerfile` também já está pronto.

A publicação leva uns 2 minutos. Em **Logs** deve aparecer:

```
✓ Banco de dados online conectado (Postgres/Supabase)
```

### Conferir que está salvando

1. Abra o app e veja **Mais**: tem que aparecer **"Dados salvos online ✓"**.
2. Cadastre uma cliente de teste.
3. No Render, clique em **Manual Deploy → Restart service**.
4. Abra o app de novo: **a cliente tem que continuar lá**. No Supabase, em **Table Editor → clients**, ela também aparece.

Se aparecer um **aviso vermelho** no topo das telas, o app não está usando o Supabase. Confira a `DATABASE_URL`.

---

## 4. Instalar no iPhone

1. Abra o endereço (por exemplo `https://agenda-expert.onrender.com`) no **Safari** e faça o login.
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

## 5. Conectar o WhatsApp (robô de confirmação)

1. No app, abra **Mais → WhatsApp** (tem o botão **▶ Tutorial**).
2. Conecte de um dos dois jeitos:
   - **Pelo computador:** escaneie o QR code.
   - **Pelo próprio iPhone:** use **Conectar com número**.
3. Ligue o **envio automático**.

A conexão fica guardada **no Supabase**, então continua ativa depois de reinícios.

---

## Trocar o e-mail ou a senha de acesso

1. No Render, vá em **Environment** e edite `ADMIN_EMAIL` e/ou `ADMIN_PASSWORD`.
2. Clique em **Save Changes**. O app reinicia com o novo acesso, e quem estava conectado precisa entrar de novo.

Se a senha estiver vazia ou tiver menos de 8 caracteres, o app **não sobe** e mostra o motivo em **Logs**.

## Plano Free do Render: o servidor "dorme"

Os dados ficam no Supabase, então **nada se perde**. Mas depois de 15 minutos sem uso, o servidor do Render desliga sozinho:

- a primeira abertura depois disso leva cerca de 1 minuto;
- enquanto ele dorme, o robô do WhatsApp não envia mensagens.

Para manter acordado de graça, crie um monitor em <https://uptimerobot.com> que acessa `https://SEU-APP.onrender.com/api/health` a cada 5 minutos.

## Cópias de segurança

| Tipo | Onde fica |
|---|---|
| Banco de dados | No **Supabase**, que tem os próprios backups. |
| Arquivo com todos os dados | No app, em **Mais → Baixar cópia de segurança**. Vale guardar uma vez por mês no iCloud ou no Drive. |
| Restaurar uma cópia | No computador, com a `DATABASE_URL` no `.env`: `npm run restaurar -- arquivo.json` |

## Se algo der errado

- **`✖ Não foi possível conectar ao banco de dados`** nos Logs: a `DATABASE_URL` está errada. Os erros mais comuns são:
  - a senha ainda está como `[YOUR-PASSWORD]`;
  - a senha tem símbolos;
  - foi usada a conexão "Direct" em vez de **Session pooler**.
- **`✖ Defina ADMIN_EMAIL e ADMIN_PASSWORD`** nos Logs: faltam essas variáveis, ou a senha é curta.
- **O projeto do Supabase foi pausado:** no plano Free, o Supabase pausa projetos sem uso por cerca de uma semana. É só entrar no painel e clicar em **Restore project**. Os dados continuam lá. Com o UptimeRobot acessando o app a cada 5 minutos, isso não acontece.
