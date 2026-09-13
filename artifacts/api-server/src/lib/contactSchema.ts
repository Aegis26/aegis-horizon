import type { PoolClient } from "pg";
import { withStartupMigrationLock } from "./startupMigration";

/**
 * contacts predates the row-ownership fields and the inactive-record fields
 * used by the current CRM routes. Railway builds the application without
 * running drizzle-kit, so keep this compatibility migration deliberately
 * limited to those additive contact columns.
 */
export async function migrateContactSchema(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE contacts
      ADD COLUMN IF NOT EXISTS owner_user_id uuid,
      ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
      ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
  `);

  // The two ownership columns are nullable by design. If a legacy deployment
  // already had one without the current FK, add the same SET NULL constraint
  // as the Drizzle schema. Existing valid constraints are left untouched.
  await client.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      -- Legacy installations may store contact references as text. Preserve
      -- those values/types; a UUID FK cannot be attached to a text column.
      IF (SELECT atttypid FROM pg_attribute
          WHERE attrelid = 'contacts'::regclass AND attname = 'owner_user_id')
         IS DISTINCT FROM
         (SELECT atttypid FROM pg_attribute
          WHERE attrelid = 'users'::regclass AND attname = 'id') THEN
        RETURN;
      END IF;
      FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'contacts'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND c.conkey = ARRAY[
            (
              SELECT a.attnum
              FROM pg_attribute a
              WHERE a.attrelid = 'contacts'::regclass
                AND a.attname = 'owner_user_id'
                AND NOT a.attisdropped
            )
          ]::smallint[]
          AND c.confdeltype <> 'n'
      LOOP
        EXECUTE format(
          'ALTER TABLE contacts DROP CONSTRAINT %I',
          constraint_name
        );
      END LOOP;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'contacts'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND c.conkey = ARRAY[
            (
              SELECT a.attnum
              FROM pg_attribute a
              WHERE a.attrelid = 'contacts'::regclass
                AND a.attname = 'owner_user_id'
                AND NOT a.attisdropped
            )
          ]::smallint[]
          AND c.confdeltype = 'n'
      ) THEN
        ALTER TABLE contacts
          ADD CONSTRAINT contacts_owner_user_id_users_fk
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      IF (SELECT atttypid FROM pg_attribute
          WHERE attrelid = 'contacts'::regclass AND attname = 'created_by_user_id')
         IS DISTINCT FROM
         (SELECT atttypid FROM pg_attribute
          WHERE attrelid = 'users'::regclass AND attname = 'id') THEN
        RETURN;
      END IF;
      FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'contacts'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND c.conkey = ARRAY[
            (
              SELECT a.attnum
              FROM pg_attribute a
              WHERE a.attrelid = 'contacts'::regclass
                AND a.attname = 'created_by_user_id'
                AND NOT a.attisdropped
            )
          ]::smallint[]
          AND c.confdeltype <> 'n'
      LOOP
        EXECUTE format(
          'ALTER TABLE contacts DROP CONSTRAINT %I',
          constraint_name
        );
      END LOOP;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'contacts'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND c.conkey = ARRAY[
            (
              SELECT a.attnum
              FROM pg_attribute a
              WHERE a.attrelid = 'contacts'::regclass
                AND a.attname = 'created_by_user_id'
                AND NOT a.attisdropped
            )
          ]::smallint[]
          AND c.confdeltype = 'n'
      ) THEN
        ALTER TABLE contacts
          ADD CONSTRAINT contacts_created_by_user_id_users_fk
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  // Keep defaults correct if a partially upgraded deployment already has the
  // columns. No ownership values are backfilled.
  await client.query(`
    ALTER TABLE contacts
      ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
      ALTER COLUMN is_active SET DEFAULT true
  `);
}

export async function ensureContactSchema(): Promise<void> {
  return withStartupMigrationLock(
    "workspace:contact-schema",
    migrateContactSchema,
  );
}