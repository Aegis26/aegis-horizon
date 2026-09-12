import { withStartupMigrationLock } from "./startupMigration";

/**
 * Account deletion state is intentionally the only account-deletion migration
 * performed at startup. It is independent of users/orgs so a completed
 * tombstone survives the destructive transaction.
 */
export async function ensureAccountDeletionSchema(): Promise<void> {
  return withStartupMigrationLock(
    "workspace:account-deletion-schema",
    async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS account_deletion_ledger (
      id uuid PRIMARY KEY,
      user_id uuid,
      user_opaque_hash text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      phase text NOT NULL DEFAULT 'organizations',
      current_organization_id uuid,
      attempts integer NOT NULL DEFAULT 0,
      lease_token text,
      lease_until timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    )
  `);
  await client.query(`
    ALTER TABLE account_deletion_ledger
      ADD COLUMN IF NOT EXISTS current_organization_id uuid
  `);
  await client.query(`
    ALTER TABLE account_deletion_ledger
      ADD COLUMN IF NOT EXISTS user_id uuid,
      ADD COLUMN IF NOT EXISTS user_opaque_hash text,
      ADD COLUMN IF NOT EXISTS status text,
      ADD COLUMN IF NOT EXISTS phase text,
      ADD COLUMN IF NOT EXISTS attempts integer,
      ADD COLUMN IF NOT EXISTS lease_until timestamptz,
      ADD COLUMN IF NOT EXISTS last_error_code text,
      ADD COLUMN IF NOT EXISTS created_at timestamptz,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz
  `);
  await client.query(`
    ALTER TABLE account_deletion_ledger
      ALTER COLUMN phase SET DEFAULT 'organizations',
      ALTER COLUMN status SET DEFAULT 'pending'
  `);
  await client.query(`
    ALTER TABLE account_deletion_ledger
      ALTER COLUMN user_id DROP NOT NULL
  `);
  await client.query(`
    ALTER TABLE account_deletion_ledger
      ADD COLUMN IF NOT EXISTS lease_token text
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_ledger_user_uq
      ON account_deletion_ledger (user_id)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_ledger_hash_uq
      ON account_deletion_ledger (user_opaque_hash)
  `);
  await client.query(`
    UPDATE account_deletion_ledger
       SET user_id = NULL
     WHERE status = 'completed'
  `);

  // Older deployments used RESTRICT + NOT NULL for provider claimants and
  // cascading sync state. Both would either block deletion or remove a
  // surviving organization's connector state. Replace only those two
  // constraints; this is not a general schema push.
  await client.query(`
    ALTER TABLE provider_bindings
      ALTER COLUMN bound_by_user_id DROP NOT NULL
  `);
  await client.query(`
    DO $$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'provider_bindings'::regclass
          AND contype = 'f'
          AND confrelid = 'users'::regclass
      LOOP
        EXECUTE format(
          'ALTER TABLE provider_bindings DROP CONSTRAINT %I',
          constraint_name
        );
      END LOOP;
    END $$;
  `);
  await client.query(`
    ALTER TABLE provider_bindings
      ADD CONSTRAINT provider_bindings_bound_by_user_id_users_fk
      FOREIGN KEY (bound_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  `);
  await client.query(`
    DO $$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'provider_sync_states'::regclass
          AND contype = 'f'
          AND confrelid = 'users'::regclass
      LOOP
        EXECUTE format(
          'ALTER TABLE provider_sync_states DROP CONSTRAINT %I',
          constraint_name
        );
      END LOOP;
    END $$;
  `);
  await client.query(`
    ALTER TABLE provider_sync_states
      ADD CONSTRAINT provider_sync_states_user_id_users_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  `);
  await client.query(`
    ALTER TABLE internal_notes
      ALTER COLUMN author_user_id DROP NOT NULL
  `);
  await client.query(`
    DO $$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'internal_notes'::regclass
          AND contype = 'f'
          AND confrelid = 'users'::regclass
      LOOP
        EXECUTE format(
          'ALTER TABLE internal_notes DROP CONSTRAINT %I',
          constraint_name
        );
      END LOOP;
    END $$;
  `);
  await client.query(`
    ALTER TABLE internal_notes
      ADD CONSTRAINT internal_notes_author_user_id_users_fk
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL
  `);
  await client.query(`
    DO $$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'usage_logs'::regclass
          AND contype = 'f'
          AND confrelid = 'users'::regclass
      LOOP
        EXECUTE format(
          'ALTER TABLE usage_logs DROP CONSTRAINT %I',
          constraint_name
        );
      END LOOP;
    END $$;
  `);
  await client.query(`
    ALTER TABLE usage_logs
      ADD CONSTRAINT usage_logs_user_id_users_fk
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  `);
    },
  );
}