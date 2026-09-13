import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";

/**
 * Opt-in because this uses a transaction and a temporary contacts table on
 * the configured development database. No persistent application rows are
 * created or changed.
 *
 * NODE_ENV=test CONTACT_SCHEMA_INTEGRATION=1 pnpm --filter @workspace/api-server test
 */
const integrationEnabled =
  process.env.NODE_ENV === "test" &&
  process.env.CONTACT_SCHEMA_INTEGRATION === "1";

type DbModule = typeof import("@workspace/db");
type SchemaModule = typeof import("./contactSchema");
type ContactDatabase = ReturnType<
  typeof drizzle<{ contacts: DbModule["contacts"] }, import("pg").PoolClient>
>;

let dbModule: DbModule | undefined;
let schema: SchemaModule | undefined;
let client: import("pg").PoolClient | undefined;
let txDb: ContactDatabase | undefined;
let contactTable: DbModule["contacts"] | undefined;
let rowId = "";
let accountId = "";
let orgId = "";

before(async () => {
  if (!integrationEnabled) return;

  dbModule = await import("@workspace/db");
  schema = await import("./contactSchema");
  client = await dbModule.pool.connect();
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMPORARY TABLE users (
      id uuid PRIMARY KEY
    ) ON COMMIT DROP
  `);
  await client.query(`
    CREATE TEMPORARY TABLE contacts (
      id uuid PRIMARY KEY,
      org_id uuid NOT NULL,
      account_id uuid NOT NULL,
      first_name text NOT NULL,
      last_name text NOT NULL,
      email text,
      phone text,
      title text,
      department text,
      role_in_deal text,
      seniority text,
      engagement_level integer,
      relationship_strength integer,
      reports_to_contact_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    ) ON COMMIT DROP
  `);

  rowId = randomUUID();
  accountId = randomUUID();
  orgId = randomUUID();
  await client.query(
    `INSERT INTO contacts (
       id, org_id, account_id, first_name, last_name, email, title
     ) VALUES ($1, $2, $3, 'Legacy', 'Contact', $4, 'Preserved')
    `,
    [rowId, orgId, accountId, `${rowId}@synthetic.invalid`],
  );

  contactTable = dbModule.contacts;
  txDb = drizzle(client, { schema: { contacts: contactTable } });
});

after(async () => {
  if (client) {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
  if (dbModule) await dbModule.pool.end();
});

test(
  "contact compatibility migration upgrades a legacy table without changing its row",
  { skip: !integrationEnabled },
  async () => {
    assert.ok(client);
    assert.ok(schema);
    assert.ok(txDb);
    assert.ok(contactTable);

    const selectLegacyContacts = () =>
      txDb!
        .select()
        .from(contactTable!)
        .where(
          and(
            eq(contactTable!.accountId, accountId),
            eq(contactTable!.isActive, true),
            eq(contactTable!.orgId, orgId),
          ),
        )
        .orderBy(contactTable!.lastName);

    // A legacy table lacks the four additive fields selected by the current
    // ORM. Roll back only this failed statement so the surrounding test
    // transaction remains usable.
    await client.query("SAVEPOINT before_contact_orm_select");
    await assert.rejects(selectLegacyContacts(), (error: unknown) => {
      let candidate: unknown = error;
      for (let depth = 0; depth < 3; depth += 1) {
        if (typeof candidate !== "object" || candidate === null) return false;
        const details = candidate as {
          code?: unknown;
          column?: unknown;
          message?: unknown;
          cause?: unknown;
        };
        if (details.code === "42703" && details.column === "owner_user_id") {
          return true;
        }
        if (
          typeof details.message === "string" &&
          details.message.includes('column "owner_user_id" does not exist')
        ) {
          return true;
        }
        candidate = details.cause;
      }
      return false;
    });
    await client.query("ROLLBACK TO SAVEPOINT before_contact_orm_select");

    await schema.migrateContactSchema(client);
    const firstRead = await selectLegacyContacts();
    assert.equal(firstRead.length, 1);
    assert.equal(firstRead[0]!.id, rowId);
    assert.equal(firstRead[0]!.firstName, "Legacy");
    assert.equal(firstRead[0]!.email, `${rowId}@synthetic.invalid`);
    assert.deepEqual(firstRead[0]!.metadata, {});
    assert.equal(firstRead[0]!.isActive, true);
    assert.equal(firstRead[0]!.ownerUserId, null);
    assert.equal(firstRead[0]!.createdByUserId, null);

    // Running the same migration again must be a no-op and preserve the row.
    await schema.migrateContactSchema(client);
    const secondRead = await selectLegacyContacts();
    assert.deepEqual(secondRead, firstRead);

    const foreignKeys = await client.query<{
      column_name: string;
      confdeltype: string;
    }>(`
      SELECT a.attname AS column_name, c.confdeltype
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = 'contacts'::regclass
        AND c.contype = 'f'
        AND c.confrelid = 'users'::regclass
        AND a.attname IN ('owner_user_id', 'created_by_user_id')
      ORDER BY a.attname
    `);
    assert.deepEqual(
      foreignKeys.rows.map((row) => [row.column_name, row.confdeltype]),
      [
        ["created_by_user_id", "n"],
        ["owner_user_id", "n"],
      ],
    );
  },
);