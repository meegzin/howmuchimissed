# Planejador de Faltas Acadêmicas

Aplicação web multiusuário para acompanhar faltas por disciplina sem ultrapassar 25% dos encontros oficiais.

Também é possível importar uma grade semanal em PDF exportada pelo aSc TimeTables. O sistema usa OCR, apresenta uma revisão antes da gravação e sugere 40h de carga total para cada encontro semanal.

## Desenvolvimento

Requer Node.js 24 ou superior.

```bash
npm install
npm run dev
```

A interface abre em `http://localhost:5173` e a API em `http://localhost:3001`. Sem variáveis de ambiente, o desenvolvimento local usa `server/data/planner.db`. Em produção, a API exige Supabase; copie `.env.example` para `.env` e preencha os valores.

```bash
npm test
npm run lint
npm run build
```

## Supabase e beta privado

1. Crie um projeto e execute `supabase/migrations/202608270001_multiuser.sql` no SQL Editor.
2. Em Authentication, desative novos cadastros públicos e configure uma senha mínima de 10 caracteres.
3. Copie URL, chave publicável e chave secreta para `.env`. Nunca exponha a chave secreta no frontend.
4. Crie a primeira conta:

```bash
npm run admin:user -w server -- create seu-email@exemplo.com
```

O comando exibe uma senha temporária uma única vez. Para redefinir uma conta sem SMTP:

```bash
npm run admin:user -w server -- reset aluno@exemplo.com
```

## Migrar o SQLite atual

Use o UUID mostrado pelo comando de criação ou pelo Dashboard. O primeiro comando apenas simula:

```bash
npm run migrate:sqlite -w server -- --user UUID
npm run migrate:sqlite -w server -- --user UUID --apply
```

O modo `--apply` recusa usuários que já tenham dados e não modifica o SQLite original.

## Backup

```bash
npm run backup -w server -- --output ../backups/backup-AAAA-MM-DD.json
```

O arquivo contém dados de todos os usuários. Guarde-o em local protegido e fora do repositório.

## Deploy no Render

O `render.yaml` cria um Static Site para o React e um Web Service gratuito para a API. Conecte o repositório no Render, preencha as variáveis marcadas como secretas e, depois de obter a URL do frontend, use-a em `ALLOWED_ORIGINS`.

O serviço gratuito pode adormecer após inatividade. O PostgreSQL permanece no Supabase; nenhum dado persistente depende do filesystem do Render.
