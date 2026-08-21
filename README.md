# Planejador de Faltas Acadêmicas

Aplicação local para acompanhar faltas por disciplina sem ultrapassar 25% dos encontros oficiais.

Também é possível importar uma grade semanal em PDF exportada pelo aSc TimeTables. O sistema usa OCR local, apresenta uma revisão antes da gravação e sugere 40h de carga total para cada encontro semanal (40h para uma vez por semana, 80h para duas).

O usuário informa apenas a data de início das aulas. Para cada disciplina, o sistema gera automaticamente `carga horária ÷ duração do encontro` aulas datadas e arredonda o limite de 25% para baixo. Aulas canceladas permanecem no grid e podem ser marcadas posteriormente como repostas na mesma data.

## Executar

Requer Node.js 24 ou superior.

```bash
npm install
npm run dev
```

A interface abre em `http://localhost:5173` e a API em `http://localhost:3001`.

```bash
npm test
npm run lint
npm run build
```

Os dados ficam em `server/data/planner.db` e não são versionados.
