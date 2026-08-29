import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc копирует только .ts — SQL-файлы миграций нужно перенести в dist отдельно,
// иначе собранный сервер не сможет применить их при старте.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src/db/migrations');
const target = path.join(root, 'dist/db/migrations');

await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Миграции скопированы в ${path.relative(root, target)}`);
