import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

assert.equal(process.env.NODE_ENV, "test");
const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl);
const parsed = new URL(databaseUrl);
assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname));
assert.match(parsed.pathname.slice(1), /^depa_os_test(?:_|$)/);

test("Residential Complex address constraints preserve ownership, uniqueness and at least one address", async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("BEGIN");
  try {
    const suffix = crypto.randomUUID();
    const user = `rc_user_${suffix}`;
    const employee = `rc_employee_${suffix}`;
    const complexA = `rc_a_${suffix}`;
    const complexB = `rc_b_${suffix}`;
    const addressA1 = `rca_a1_${suffix}`;
    const addressA2 = `rca_a2_${suffix}`;
    const addressB1 = `rca_b1_${suffix}`;
    const at = Math.floor(Date.now() / 1000);
    await client.query("INSERT INTO employees(id,full_name,status,created_at,updated_at) VALUES($1,'RC Integration','ACTIVE',$2,$2)", [employee, at]);
    await client.query("INSERT INTO users(id,employee_id,auth_provider,username,username_normalized,display_name,role,status,is_protected_owner,created_at,updated_at) VALUES($1,$2,'LOCAL',$1,$1,'RC Integration','OWNER','ACTIVE',0,$3,$3)", [user, employee, at]);
    await client.query("INSERT INTO residential_complexes(id,name,normalized_name,city,status,created_by_user_id,created_at,updated_at) VALUES($1,'Комплекс A','комплекс a','Владивосток','ACTIVE',$3,$4,$4),($2,'Комплекс B','комплекс b','Владивосток','ACTIVE',$3,$4,$4)", [complexA, complexB, user, at]);
    await client.query("INSERT INTO residential_complex_addresses(id,residential_complex_id,address,normalized_address,position,created_at,updated_at) VALUES($1,$2,'Одинаковая улица, 1','одинаковая улица, 1',0,$3,$3),($4,$5,'Одинаковая улица, 1','одинаковая улица, 1',0,$3,$3),($6,$2,'Вторая улица, 2','вторая улица, 2',1,$3,$3)", [addressA1, complexA, at, addressB1, complexB, addressA2]);

    await client.query("SAVEPOINT duplicate_check");
    await assert.rejects(
      client.query("INSERT INTO residential_complex_addresses(id,residential_complex_id,address,normalized_address,position,created_at,updated_at) VALUES($1,$2,' ОДИНАКОВАЯ УЛИЦА, 1 ','одинаковая улица, 1',2,$3,$3)", [`duplicate_${suffix}`, complexA, at]),
      /residential_complex_addresses_value_unique/,
    );
    await client.query("ROLLBACK TO SAVEPOINT duplicate_check");
    await client.query("DELETE FROM residential_complex_addresses WHERE id=$1", [addressA2]);
    await client.query("SAVEPOINT last_address_check");
    await assert.rejects(
      client.query("DELETE FROM residential_complex_addresses WHERE id=$1", [addressA1]),
      /must retain at least one address/i,
    );
    await client.query("ROLLBACK TO SAVEPOINT last_address_check");
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

test("0021 installs exact composite ownership constraints for every downstream entity", async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const rows = await pool.query("SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[]) ORDER BY conname", [[
      "inspections_residential_complex_address_owner_fkey",
      "design_projects_residential_complex_address_owner_fkey",
      "renovation_order_details_residential_complex_address_owner_fkey",
      "projects_residential_complex_address_owner_fkey",
      "estimates_residential_complex_address_owner_fkey",
    ]]);
    assert.equal(rows.rowCount, 5);
  } finally {
    await pool.end();
  }
});
