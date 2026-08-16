import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("attachments use private Blob metadata instead of Base64", async () => {
  const [schema, files, client, migration] = await Promise.all([
    read("db/schema.ts"), read("lib/files.ts"), read("app/finance-ui.tsx"), read("drizzle/postgres/0004_postgres_integrity_and_blob.sql"),
  ]);
  assert.match(schema, /storageProvider/);
  assert.match(schema, /checksumSha256/);
  assert.doesNotMatch(schema, /contentBase64|content_base64/);
  assert.match(files, /\.private\.blob\.vercel-storage\.com/);
  assert.match(files, /RECEIPT_MAX_BYTES = 10/);
  assert.match(client, /access: "private"/);
  assert.doesNotMatch(client, /btoa\(|readAsDataURL|contentBase64/);
  assert.match(migration, /DROP COLUMN content_base64/);
});

test("protected file routes require DEPA auth and validate access", async () => {
  const [uploadRoute, fileRoute, files] = await Promise.all([
    read("app/api/files/upload/route.ts"), read("app/api/files/[attachmentId]/route.ts"), read("lib/files.ts"),
  ]);
  assert.match(uploadRoute, /getRequestUser/);
  assert.match(fileRoute, /getRequestUser/);
  assert.match(fileRoute, /access: "private"/);
  assert.match(files, /user_project_access/);
  assert.match(files, /FILE_UPLOADED/);
  assert.match(files, /FILE_LINKED|FILE_DELETED|FILE_VIEWED/);
});

test("PostgreSQL migration adds restrictive foreign keys and keeps legacy history separate", async () => {
  const [config, schema, migration, migrator] = await Promise.all([
    read("drizzle.config.ts"), read("db/schema.ts"), read("drizzle/postgres/0004_postgres_integrity_and_blob.sql"), read("scripts/migrate-postgres.mjs"),
  ]);
  assert.match(config, /dialect: "postgresql"/);
  assert.match(schema, /drizzle-orm\/pg-core/);
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.match(migration, /orphan row/);
  assert.doesNotMatch(migrator, /replaceAll\("`"|strftime|PRAGMA/);
});
