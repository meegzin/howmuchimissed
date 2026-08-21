import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createDatabase } from './db.js';
import { createApp } from './app.js';

const port = process.env.PORT || 3001;
const here = dirname(fileURLToPath(import.meta.url));
const preferredPath = join(here, '..', 'data', 'planner.db');
const legacyPath = join(here, '..', 'server', 'data', 'planner.db');
const db = createDatabase(process.env.DB_PATH || (existsSync(preferredPath) || !existsSync(legacyPath) ? preferredPath : legacyPath));
createApp(db).listen(port, () => console.log(`API disponível em http://localhost:${port}`));
