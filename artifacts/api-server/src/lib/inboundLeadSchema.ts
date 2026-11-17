import { withStartupMigrationLock } from "./startupMigration";

export async function ensureInboundLeadSchema(): Promise<void> {
  await withStartupMigrationLock("workspace:inbound-leads", async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS inbound_lead_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
        timestamp timestamptz NOT NULL DEFAULT now(),
        external_id text, result text NOT NULL, error text
      );
      CREATE TABLE IF NOT EXISTS inbound_lead_rate (
        org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        key_id text NOT NULL, window_start timestamptz NOT NULL,
        count integer NOT NULL, PRIMARY KEY (org_id, key_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS leads_radar_external_unique
        ON leads (org_id, (metadata->'leadRadar'->>'external_id'))
        WHERE metadata->'leadRadar'->>'external_id' IS NOT NULL;
      CREATE INDEX IF NOT EXISTS inbound_lead_log_timestamp_idx
        ON inbound_lead_log (timestamp);
    `);
  });
}
