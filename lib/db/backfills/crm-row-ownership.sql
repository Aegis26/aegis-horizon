-- Deployment order: first apply the additive nullable columns with
-- `pnpm db:push` while the old API is still running; then deploy the compatible
-- API code; then execute this file once with the production migration operator;
-- finally run the verification queries below. Consider NOT NULL constraints
-- only in a later release. This file is never run at application startup.
-- This transaction fails closed when an organization has CRM rows but no owner.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT org_id FROM accounts
      UNION SELECT org_id FROM contacts
      UNION SELECT org_id FROM opportunities
      UNION SELECT org_id FROM leads
    ) crm_orgs
    WHERE NOT EXISTS (
      SELECT 1 FROM org_users ou
      WHERE ou.org_id = crm_orgs.org_id AND ou.role = 'owner'
    )
  ) THEN
    RAISE EXCEPTION 'CRM ownership backfill aborted: at least one organization has no owner';
  END IF;
END $$;

-- Remediate stale cross-tenant references before selecting the fallback owner.
-- A user may exist globally without belonging to this record's organization.
UPDATE accounts r SET owner_user_id = NULL
WHERE owner_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.owner_user_id
);
UPDATE accounts r SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.created_by_user_id
);
UPDATE contacts r SET owner_user_id = NULL
WHERE owner_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.owner_user_id
);
UPDATE contacts r SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.created_by_user_id
);
UPDATE opportunities r SET owner_user_id = NULL
WHERE owner_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.owner_user_id
);
UPDATE opportunities r SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.created_by_user_id
);
UPDATE leads r SET assigned_to_user_id = NULL
WHERE assigned_to_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.assigned_to_user_id
);
UPDATE leads r SET created_by_user_id = NULL
WHERE created_by_user_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM org_users ou WHERE ou.org_id = r.org_id AND ou.user_id = r.created_by_user_id
);

WITH owners AS (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM org_users WHERE role = 'owner'
  ORDER BY org_id, created_at, user_id
)
UPDATE accounts a SET
  owner_user_id = COALESCE(a.owner_user_id, o.user_id),
  created_by_user_id = COALESCE(a.created_by_user_id, o.user_id)
FROM owners o WHERE a.org_id = o.org_id
  AND (a.owner_user_id IS NULL OR a.created_by_user_id IS NULL);

WITH owners AS (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM org_users WHERE role = 'owner'
  ORDER BY org_id, created_at, user_id
)
UPDATE contacts c SET
  owner_user_id = COALESCE(c.owner_user_id, o.user_id),
  created_by_user_id = COALESCE(c.created_by_user_id, o.user_id)
FROM owners o WHERE c.org_id = o.org_id
  AND (c.owner_user_id IS NULL OR c.created_by_user_id IS NULL);

WITH owners AS (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM org_users WHERE role = 'owner'
  ORDER BY org_id, created_at, user_id
)
UPDATE opportunities p SET
  owner_user_id = COALESCE(p.owner_user_id, o.user_id),
  created_by_user_id = COALESCE(p.created_by_user_id, o.user_id)
FROM owners o WHERE p.org_id = o.org_id
  AND (p.owner_user_id IS NULL OR p.created_by_user_id IS NULL);

WITH owners AS (
  SELECT DISTINCT ON (org_id) org_id, user_id
  FROM org_users WHERE role = 'owner'
  ORDER BY org_id, created_at, user_id
)
UPDATE leads l SET
  assigned_to_user_id = COALESCE(l.assigned_to_user_id, o.user_id),
  created_by_user_id = COALESCE(l.created_by_user_id, o.user_id)
FROM owners o WHERE l.org_id = o.org_id
  AND (l.assigned_to_user_id IS NULL OR l.created_by_user_id IS NULL);

COMMIT;

-- Verification (run after COMMIT):
-- SELECT count(*) FROM accounts a WHERE NOT EXISTS (SELECT 1 FROM org_users ou WHERE ou.org_id=a.org_id AND ou.user_id=a.owner_user_id)
--   OR NOT EXISTS (SELECT 1 FROM org_users ou WHERE ou.org_id=a.org_id AND ou.user_id=a.created_by_user_id);
-- Repeat for contacts (owner_user_id/created_by_user_id), opportunities
-- (owner_user_id/created_by_user_id), and leads (assigned_to_user_id/created_by_user_id).