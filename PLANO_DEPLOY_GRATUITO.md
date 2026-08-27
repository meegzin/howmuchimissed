# Plano para lançamento gratuito do MVP

> Implementação preparada em 27 de agosto de 2026. O repositório agora contém schema PostgreSQL com RLS, autenticação privada, scripts operacionais, CI e Blueprint do Render. A criação dos serviços e a migração efetiva aguardam as credenciais dos provedores.

> Documento de continuidade criado em 21 de agosto de 2026. Planos, limites e preços de provedores mudam com frequência; confirme as condições oficiais antes do lançamento.

## Resumo

É tecnicamente possível lançar uma versão beta do Planejador de Faltas por R$ 0, mas sem garantia de disponibilidade, desempenho ou permanência dos planos gratuitos.

O projeto não deve ser disponibilizado para vários alunos com a arquitetura atual. Hoje ele utiliza SQLite e foi projetado para um único usuário. Se publicado dessa forma, todos os visitantes compartilhariam os mesmos dados.

Antes do lançamento público, será necessário migrar para uma arquitetura multiusuário com autenticação e isolamento dos dados.

## Stack gratuita sugerida

| Componente | Serviço sugerido | Custo inicial |
| --- | --- | ---: |
| Frontend React | Render Static Site | R$ 0 |
| API Express e OCR | Render Free Web Service | R$ 0 |
| PostgreSQL | Supabase Free | R$ 0 |
| Login | Supabase Auth | R$ 0 |
| Repositório e deploy | GitHub | R$ 0 |
| Endereço inicial | Subdomínio gratuito | R$ 0 |

Não é necessário comprar um domínio durante o beta. O aplicativo pode usar um endereço gratuito como:

```text
meu-planejador.onrender.com
```

## Arquitetura recomendada

```text
Frontend React
      |
      v
API Express + OCR
      |
      v
PostgreSQL + Supabase Auth
```

O Supabase será responsável pelo banco de dados e pela autenticação. O Express continuará responsável pelas regras de negócio e pelo processamento dos PDFs.

## Mudanças obrigatórias antes do lançamento

### Banco de dados

- Migrar de SQLite para PostgreSQL.
- Criar migrações versionadas do banco.
- Adicionar um `user_id` aos dados pertencentes ao aluno.
- Vincular disciplinas, horários, faltas, cancelamentos e início do semestre ao usuário.
- Criar índices para as consultas por usuário.
- Implementar exclusão em cascata quando uma conta for removida.

Estrutura conceitual:

```text
users
semesters
classes
class_schedules
absences
exclusions
```

### Autenticação e autorização

- Adicionar cadastro e login.
- Começar com e-mail e senha ou link mágico.
- Validar o token do usuário em todos os endpoints protegidos.
- Garantir que cada consulta seja filtrada pelo usuário autenticado.
- Ativar Row Level Security no PostgreSQL.
- Criar políticas que impeçam um aluno de acessar dados de outro.
- Adicionar recuperação de acesso e exclusão da conta.

### API e produção

- Preparar o Express para ambiente de produção.
- Decidir entre servir o React pelo próprio Express ou manter frontend e API separados.
- Configurar variáveis de ambiente e segredos.
- Configurar CORS caso frontend e API usem domínios diferentes.
- Adicionar endpoint de verificação de saúde.
- Adicionar cabeçalhos de segurança.
- Adicionar rate limiting.
- Padronizar logs sem incluir PDFs ou dados sensíveis.
- Criar tratamento global de erros.

### Importação e OCR

- Manter o limite de 10 MB por PDF.
- Validar o formato real do arquivo, não apenas sua extensão.
- Processar o PDF somente em memória.
- Descartar o arquivo imediatamente depois do OCR.
- Limitar importações simultâneas por usuário e por IP.
- Aplicar timeout ao processamento.
- Exibir progresso e mensagens claras na interface.
- Medir consumo de memória e CPU com diferentes grades.
- Considerar uma fila de processamento se o uso crescer.

## Limitações dos planos gratuitos

### Render

O serviço web gratuito pode ser desligado depois de 15 minutos sem receber tráfego. O primeiro acesso seguinte pode levar aproximadamente um minuto para reativá-lo.

O sistema de arquivos da instância gratuita é temporário. Arquivos e bancos SQLite locais podem desaparecer em reinícios, períodos de inatividade ou novos deploys. Por isso, os dados persistentes devem ficar no PostgreSQL externo.

O OCR é o principal risco técnico: renderização de PDF e reconhecimento de texto consomem mais CPU e memória que os demais endpoints. Precisamos verificar se a instância gratuita suporta arquivos reais de forma confiável.

Documentação: [Render gratuito](https://render.com/docs/free)

### Supabase

No momento da criação deste documento, o plano gratuito informa:

- 500 MB de banco de dados.
- 50 mil usuários ativos mensais.
- 5 GB de transferência.
- 1 GB de armazenamento de arquivos.
- Até dois projetos ativos.
- Pausa após uma semana sem atividade.
- Ausência de backups automáticos.

Para este MVP, 500 MB deve comportar muitos usuários porque armazenaremos principalmente textos, datas e horários. Os PDFs não precisam ser armazenados.

Documentação: [Preços do Supabase](https://supabase.com/pricing)

### Railway e Fly.io

O Railway disponibiliza créditos de avaliação, mas não deve ser tratado como uma garantia de hospedagem gratuita permanente.

Documentação: [Preços do Railway](https://railway.com/pricing)

O Fly.io não oferece um plano gratuito geral para novas contas, e volumes persistentes são cobrados.

Documentação: [Gestão de custos do Fly.io](https://fly.io/docs/about/cost-management/)

## Segurança e privacidade

- Criar uma política de privacidade simples e clara.
- Informar que PDFs são processados e descartados.
- Não armazenar conteúdo integral do PDF sem necessidade.
- Não registrar tokens, senhas ou PDFs nos logs.
- Permitir que o usuário exclua sua conta e seus dados.
- Proteger todos os endpoints que leem ou alteram dados acadêmicos.
- Revisar dependências e vulnerabilidades antes do deploy.
- Configurar limites de requisição e upload.

## Operação

- Manter ambientes separados de desenvolvimento e produção.
- Configurar deploy automático a partir do repositório.
- Criar monitoramento de disponibilidade e erros.
- Adicionar alertas para falhas na API e no OCR.
- Criar uma rotina de exportação do banco enquanto não houver backups automáticos.
- Testar a recuperação dos dados exportados.
- Adicionar domínio próprio somente depois da validação do beta.

## Experiência do usuário

- Criar telas de cadastro, login e recuperação de acesso.
- Adicionar onboarding para início do semestre e importação da grade.
- Avisar que cargas de 40h, 80h ou 120h são sugestões editáveis.
- Mostrar um estado amigável enquanto a API gratuita está reativando.
- Exibir progresso durante o OCR.
- Informar claramente quando uma importação falhar por limite ou indisponibilidade.
- Oferecer exportação dos dados do aluno.

## Sequência recomendada

1. Criar o repositório remoto e configurar integração contínua.
2. Migrar SQLite para PostgreSQL.
3. Adicionar Supabase Auth.
4. Vincular todos os registros ao usuário.
5. Criar políticas de Row Level Security.
6. Proteger e testar todos os endpoints.
7. Preparar o Express e o React para produção.
8. Adicionar segurança, rate limiting e limites de OCR.
9. Criar testes com dois ou mais usuários para validar o isolamento.
10. Testar consumo de memória do OCR no Render gratuito.
11. Publicar em ambiente privado.
12. Convidar um pequeno grupo de alunos.
13. Monitorar desempenho, falhas e uso do banco.
14. Abrir o beta público se os resultados forem aceitáveis.

## Critérios mínimos para abrir o beta

- Um usuário não consegue consultar ou alterar dados de outro.
- Login, logout e recuperação de acesso funcionam.
- O OCR processa os PDFs de teste sem derrubar a API.
- Reinícios e novos deploys não apagam dados.
- Existe uma forma de exportar ou recuperar o banco.
- Uploads excessivos são limitados.
- Erros importantes são registrados e monitorados.
- Política de privacidade e exclusão da conta estão disponíveis.

## Alternativa: OCR no navegador

Se a API gratuita não suportar o consumo do OCR, podemos mover o processamento para o navegador do aluno. Nesse modelo:

- O dispositivo do aluno processa o PDF.
- Somente o resultado estruturado é enviado ao servidor.
- O servidor consome menos CPU e memória.
- O PDF não precisa sair do dispositivo.

Essa alternativa exigirá reescrever o importador para o ambiente do navegador e pode ser lenta em celulares modestos. A recomendação inicial é manter o OCR no servidor, medir o comportamento no beta e migrar somente se necessário.

## Decisão recomendada

Começar com:

```text
Render gratuito
|- Frontend React
`- API Express + OCR

Supabase gratuito
|- PostgreSQL
|- Autenticação
`- Row Level Security
```

Essa estrutura permite validar o produto sem cobrança obrigatória. Deve ser apresentada como beta experimental, sem promessa de disponibilidade contínua. Se o uso crescer ou o OCR ultrapassar os limites gratuitos, o primeiro custo provavelmente será a hospedagem da API.
