const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running integration tests.');
const address = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(address.hostname)) throw new Error('Integration tests require local PostgreSQL.');
const schema = `interest_map_test_${Date.now()}`;
const admin = new PrismaClient();
function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8' });
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

(async () => {
  let created = false;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    created = true;
    address.searchParams.set('schema', schema);
    const env = { ...process.env, DATABASE_URL: address.toString(), INTEREST_TEST_DATABASE_URL: address.toString() };
    const diff = run(['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], env);
    if (diff.status !== 0) throw new Error('Could not generate the integration schema.');
    // The existing PostGIS extension lives in public; application tables stay isolated.
    const sql = `SET search_path TO "${schema}";\n` + diff.stdout
      .replaceAll('"public".', `"${schema}".`)
      .replaceAll('CREATE SCHEMA IF NOT EXISTS "public";', `CREATE SCHEMA IF NOT EXISTS "${schema}";`)
      .replaceAll('geometry(Point, 4326)', '"public".geometry(Point, 4326)');
    const setup = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], { cwd: root, env, input: sql, encoding: 'utf8' });
    if (setup.status !== 0) throw new Error(setup.stderr || 'Could not prepare the integration schema.');
    const tests = run(['node_modules/jest/bin/jest.js', '--runInBand', 'src/modules/user-preference', 'src/modules/event/event.service.spec.ts'], env);
    process.stdout.write(tests.stdout);
    process.exitCode = tests.status ?? 1;
  } finally {
    if (created) await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
