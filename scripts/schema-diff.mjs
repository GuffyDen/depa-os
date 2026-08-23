import pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const normalizeType = (value) => String(value).replace(/character varying/g, "varchar").replace(/,\s+/g, ",").replace(/\s+/g, " ").trim();
const configs = [];
for (const value of Object.values(schema)) {
  try {
    const config = getTableConfig(value);
    if (!configs.some((item) => item.name === config.name)) configs.push(config);
  } catch { /* non-table export */ }
}

try {
  const tableRows = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'depa_migrations'");
  const columnRows = await pool.query(`SELECT c.relname table_name,a.attname column_name,format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,ad.adbin IS NOT NULL has_default
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'depa_migrations' AND a.attnum>0 AND NOT a.attisdropped`);
  const indexRows = await pool.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'");
  const constraintRows = await pool.query("SELECT rel.relname table_name,c.conname,c.contype,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class rel ON rel.oid=c.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace WHERE n.nspname='public'");
  const dbTables = new Set(tableRows.rows.map((row) => row.table_name));
  const drizzleTables = new Set(configs.map((config) => config.name));
  const dbColumns = new Map(columnRows.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  const dbIndexes = new Map(indexRows.rows.map((row) => [`${row.tablename}.${row.indexname}`, row]));
  const dbConstraints = new Map(constraintRows.rows.map((row) => [`${row.table_name}.${row.conname}`, row]));
  const missingTables = [...drizzleTables].filter((name) => !dbTables.has(name));
  const extraTables = [...dbTables].filter((name) => !drizzleTables.has(name));
  const missingColumns = [], extraColumns = [], columnMismatches = [], missingIndexes = [], missingConstraints = [];
  for (const config of configs) {
    const expectedColumns = new Set(config.columns.map((column) => column.name));
    for (const column of config.columns) {
      const actual = dbColumns.get(`${config.name}.${column.name}`);
      if (!actual) { missingColumns.push(`${config.name}.${column.name}`); continue; }
      const expected = { type: normalizeType(column.getSQLType()), notNull: Boolean(column.notNull), hasDefault: Boolean(column.hasDefault) };
      const received = { type: normalizeType(actual.data_type), notNull: Boolean(actual.not_null), hasDefault: Boolean(actual.has_default) };
      if (JSON.stringify(expected) !== JSON.stringify(received)) columnMismatches.push({ column: `${config.name}.${column.name}`, expected, received });
    }
    for (const row of columnRows.rows.filter((row) => row.table_name === config.name)) if (!expectedColumns.has(row.column_name)) extraColumns.push(`${config.name}.${row.column_name}`);
    for (const index of config.indexes) if (!dbIndexes.has(`${config.name}.${index.config.name}`)) missingIndexes.push(`${config.name}.${index.config.name}`);
    for (const constraint of [...config.uniqueConstraints, ...config.checks]) if (!dbConstraints.has(`${config.name}.${constraint.name}`) && !dbIndexes.has(`${config.name}.${constraint.name}`)) missingConstraints.push(`${config.name}.${constraint.name}`);
  }
  const expectedIndexNames = new Set(configs.flatMap((config) => config.indexes.map((index) => `${config.name}.${index.config.name}`)));
  const expectedConstraintNames = new Set(configs.flatMap((config) => [...config.uniqueConstraints, ...config.checks].map((constraint) => `${config.name}.${constraint.name}`)));
  const migrationManagedIndexes = [...dbIndexes.keys()].filter((name) => !name.endsWith("_pkey") && !expectedIndexNames.has(name) && !expectedConstraintNames.has(name));
  const migrationManagedConstraints = [...dbConstraints.entries()].filter(([, row]) => row.contype !== "p" && !expectedConstraintNames.has(`${row.table_name}.${row.conname}`)).map(([name, row]) => ({ name, type: row.contype, definition: row.definition }));
  const report = { expectedTableCount: configs.length, actualTableCount: dbTables.size, missingTables, extraTables, missingColumns, extraColumns, columnMismatches, missingIndexes, missingConstraints, documentedExceptions: { migrationLedger: "depa_migrations is owned by the migration runner", migrationManagedIndexes, migrationManagedConstraints, sequencesAndTriggers: "Sequences, migration triggers and trigger functions are owned by SQL migrations." } };
  report.unexpectedDriftCount = missingTables.length + extraTables.length + missingColumns.length + extraColumns.length + columnMismatches.length + missingIndexes.length + missingConstraints.length;
  console.log(JSON.stringify(report, null, 2));
  if (report.unexpectedDriftCount) process.exitCode = 1;
} finally { await pool.end(); }
