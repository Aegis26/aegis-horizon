import app from "./app";
import { logger } from "./lib/logger";
import { startWorkflowScheduler } from "./services/workflow";
import { startReportScheduler } from "./services/reportScheduler";
import { startWebhookScheduler } from "./services/webhooks";
import { ensureOrganizationDeletionLedgerSchema } from "./lib/organizationDeletionSchema";
import { ensureAccountDeletionSchema } from "./lib/accountDeletionSchema";
import { ensureWindowSessionSchema } from "./lib/windowSessionSchema";
import { ensureContactSchema } from "./lib/contactSchema";
import { startAccountDeletionRecovery } from "./services/accountDeletion";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await ensureOrganizationDeletionLedgerSchema();
await ensureAccountDeletionSchema();
await ensureWindowSessionSchema();
await ensureContactSchema();

startWorkflowScheduler();
startReportScheduler();
startWebhookScheduler();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startAccountDeletionRecovery();
});
