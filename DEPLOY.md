# Publicar o Agenda Expert (GitHub + Render)

O código fica no GitHub. O Render publica o app automaticamente a cada atualização, num endereço **https://…** que a Esther instala no iPhone.

## ⚠️ Escolha o plano Starter, não o Free

O plano **Free** do Render não serve para este app, por dois motivos:

- **Apaga os dados.** O Free não tem disco persistente, então clientes, agenda e financeiro somem a cada atualização ou reinício.
- **Fica lento.** O app "dorme" depois de 15 minutos sem uso e leva cerca de 1 minuto para abrir. A especificação pede no máximo 3 segundos (RNF04).

O arquivo `render.yaml` já vem configurado com o plano **Starter** e **1 GB de disco**. O custo é de cerca de **US$ 7 por mês** mais uns centavos do disco. Confira o valor atual em <https://render.com/pricing>.

## 1. Subir o código para o GitHub

O repositório deve ser **privado**. O `.gitignore` já impede que o `.env` (com a senha) e a pasta `data/` (com os dados) sejam enviados.

### Com o GitHub Desktop (mais fácil)

1. **File → Add local repository** e escolha a pasta `agend expert`. Se o programa disser que a pasta não é um repositório, clique em **create a repository**.
2. Escreva uma mensagem, como "Primeira versão", e clique em **Commit to main**.
3. Clique em **Publish repository**, deixe **Keep this code private** marcado e confirme.

### Pelo terminal

Rode os comandos dentro da pasta do projeto:

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Agenda Expert - primeira versão"
```

```bash
git branch -M main
```

Crie um repositório **privado** vazio em <https://github.com/new>. Depois conecte e envie, trocando `SEU-USUARIO` pelo seu usuário do GitHub:

```bash
git remote add origin https://github.com/SEU-USUARIO/agenda-expert.git
```

```bash
git push -u origin main
```

## 2. Criar o serviço no Render

1. Entre em <https://dashboard.render.com> com a sua conta do GitHub.
2. Clique em **New + → Blueprint**.
3. Conecte o GitHub e escolha o repositório **agenda-expert**. O Render lê o `render.yaml` sozinho.
4. Ele vai pedir duas variáveis:
   - **ADMIN_EMAIL**: o e-mail de acesso da Esther.
   - **ADMIN_PASSWORD**: uma senha forte, com pelo menos 8 caracteres (12 ou mais é melhor).
5. Clique em **Apply** e cadastre a forma de pagamento quando for pedida.

A primeira publicação leva uns 2 minutos. O endereço aparece no topo do serviço, algo como **https://agenda-expert.onrender.com**.

O app começa **vazio**: sem clientes, sem agenda e sem movimentações, só com os 9 procedimentos do catálogo.

## 3. Trocar o e-mail ou a senha

1. No Render, abra o serviço e vá em **Environment**.
2. Edite **ADMIN_EMAIL** e/ou **ADMIN_PASSWORD** e clique em **Save Changes**.
3. O app reinicia sozinho com o novo acesso. Quem estava conectado precisa entrar de novo.

O app não tem tela para trocar a senha, de propósito: o acesso fica só nas variáveis do servidor. Se a senha for curta (menos de 8 caracteres) ou estiver vazia, o app **não sobe**, e o Render mostra o erro em **Logs**. Assim ninguém fica com uma senha fraca por engano.

## 4. Instalar no iPhone

1. Abra o endereço no **Safari** e faça o login.
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.

## Atualizações

Toda alteração enviada ao GitHub, pelo **Push** do GitHub Desktop ou por `git push`, é publicada sozinha pelo Render. Os iPhones recebem a versão nova ao abrir o app.

## Cópias de segurança

| Tipo | Onde fica |
|---|---|
| Cópia diária do banco | `/var/data/backups` no disco do Render (as últimas 30) |
| Snapshot do disco | Feito automaticamente pelo Render. Aparece no serviço, em **Disks**. |
| Arquivo com todos os dados | No app, em **Mais → Baixar cópia de segurança**. Vale guardar uma vez por mês no iCloud ou no Drive. |

## Se algo der errado

- **O app não abre logo depois de publicar.** Veja **Logs** no Render. A mensagem `✖ Defina ADMIN_EMAIL e ADMIN_PASSWORD` significa que faltam as variáveis ou que a senha é curta.
- **Erro com `node:sqlite`.** A versão do Node está antiga. Confira se a variável **NODE_VERSION** está em `24`.
- **Os dados sumiram depois de uma atualização.** O serviço está sem disco. Confira em **Disks** se o `agenda-data` está montado em `/var/data`.
