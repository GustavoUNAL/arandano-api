/**
 * Comprueba alineación entre inventario, export TSV de lotes y recetas.
 * Sale con código 1 si hay inconsistencias.
 *
 *   npx ts-node --transpile-only scripts/verify-data-consistency.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const invPath = path.join(root, 'prisma/data/tables/inventory.json');
const tsvPath = path.join(root, 'prisma/data/inventory-purchase-lots.tsv');
const recPath = path.join(root, 'prisma/data/tables/recipes.json');

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(invPath)) fail(`Falta ${invPath}`);
  if (!fs.existsSync(tsvPath)) fail(`Falta ${tsvPath}`);
  if (!fs.existsSync(recPath)) fail(`Falta ${recPath}`);

  const inv = JSON.parse(fs.readFileSync(invPath, 'utf8')) as Array<{
    id: string;
    lot?: string | null;
  }>;
  if (!Array.isArray(inv)) fail('inventory.json: se esperaba un array');

  const invIds = new Set(inv.map((r) => r.id));
  const emptyLot = inv.filter((r) => !(r.lot ?? '').toString().trim());
  if (emptyLot.length)
    fail(
      `Hay ${emptyLot.length} filas sin lot en inventory.json (ej. ${emptyLot[0]?.id})`,
    );

  const tsv = fs.readFileSync(tsvPath, 'utf8').trim().split(/\r?\n/);
  if (tsv.length < 2) fail('TSV vacío o sin datos');
  const tsvIds = new Set<string>();
  for (let i = 1; i < tsv.length; i++) {
    const cols = tsv[i].split('\t');
    const id = cols[4]?.trim();
    if (id) tsvIds.add(id);
  }

  if (tsv.length - 1 !== inv.length)
    fail(
      `Conteo: TSV tiene ${tsv.length - 1} líneas, inventory.json ${inv.length}`,
    );
  if (tsvIds.size !== invIds.size)
    fail(`IDs distintos: TSV ${tsvIds.size}, JSON ${invIds.size}`);

  for (const id of tsvIds) {
    if (!invIds.has(id)) fail(`TSV referencia id inexistente en JSON: ${id}`);
  }
  for (const id of invIds) {
    if (!tsvIds.has(id)) fail(`JSON tiene id ausente en TSV: ${id}`);
  }

  const recipes = JSON.parse(fs.readFileSync(recPath, 'utf8')) as Array<{
    ingredients?: Array<{ productId?: string }>;
  }>;
  let missingIng = 0;
  for (const rec of recipes) {
    for (const ing of rec.ingredients ?? []) {
      const pid = ing.productId;
      if (pid && !invIds.has(pid)) missingIng++;
    }
  }
  if (missingIng > 0)
    fail(`Recetas: ${missingIng} ingredientes apuntan a inventory inexistente`);

  const lotSet = new Set(
    inv.map((r) => (r.lot ?? '').toString().trim()).filter(Boolean),
  );
  console.log('OK — datos consistentes:');
  console.log(`  • inventory.json: ${inv.length} filas`);
  console.log(`  • lotes distintos (campo lot): ${lotSet.size}`);
  console.log(`  • inventory-purchase-lots.tsv: ${tsv.length - 1} líneas, ids coincidentes`);
  console.log(`  • recipes.json: ingredientes resueltos en inventario`);
}

main();
