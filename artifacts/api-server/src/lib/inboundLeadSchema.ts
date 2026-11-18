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
          UPDATE leads SET status = 'queued',
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{leadQueue}',
              jsonb_build_object('queuedAt', created_at)),
            updated_at = now()
          WHERE source = 'Lead Radar' AND assigned_to_user_id IS NULL
            AND is_active = true AND status = 'new'
            AND converted_opportunity_id IS NULL
            AND metadata->'leadRadar' IS NOT NULL
            AND metadata->'leadQueue' IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM audit_events a
              WHERE a.org_id = leads.org_id AND a.entity_type = 'lead'
                AND a.entity_id = leads.id::text
                AND a.action NOT IN ('lead.created')
            );
      CREATE OR REPLACE FUNCTION mark_lead_queue_worked() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.assigned_to_user_id IS NOT NULL AND OLD.metadata->'leadQueue' IS NOT NULL
          AND NEW.status <> 'queued'
          AND (
            ROW(NEW.status, NEW.assigned_to_user_id, NEW.first_name, NEW.last_name,
              NEW.email, NEW.phone, NEW.company, NEW.title, NEW.industry,
              NEW.company_size, NEW.annual_revenue, NEW.country, NEW.state,
              NEW.product_interest, NEW.converted_opportunity_id)
            IS DISTINCT FROM
            ROW(OLD.status, OLD.assigned_to_user_id, OLD.first_name, OLD.last_name,
              OLD.email, OLD.phone, OLD.company, OLD.title, OLD.industry,
              OLD.company_size, OLD.annual_revenue, OLD.country, OLD.state,
              OLD.product_interest, OLD.converted_opportunity_id)
          )
        THEN
          NEW.metadata = jsonb_set(NEW.metadata, '{leadQueue,worked}', 'true'::jsonb);
        END IF;
        RETURN NEW;
      END $$;
      DROP TRIGGER IF EXISTS lead_queue_worked ON leads;
      CREATE TRIGGER lead_queue_worked BEFORE UPDATE ON leads
        FOR EACH ROW EXECUTE FUNCTION mark_lead_queue_worked();
    `);
  });
}
