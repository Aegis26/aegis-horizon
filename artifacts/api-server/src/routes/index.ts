import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import orgsRouter from "./orgs";
import billingRouter from "./billing";
import crmRouter from "./crm";
import salesRouter from "./sales";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";
import communicationsRouter from "./communications";
import automationRouter from "./automation";
import publicApiRouter from "./publicApi";
import enterpriseRouter from "./enterprise";
import reportsRouter from "./reports";
import documentsRouter from "./documents";
import webhooksRouter from "./webhooks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Specific org sub-resources must be mounted before the generic orgs router
// so their middleware chains (feature gates, role gates) apply.
router.use(billingRouter);
router.use(publicApiRouter);
router.use(enterpriseRouter);
router.use(reportsRouter);
router.use(documentsRouter);
router.use(webhooksRouter);
router.use(crmRouter);
router.use(communicationsRouter);
router.use(salesRouter);
router.use(storageRouter);
router.use(dashboardRouter);
router.use(automationRouter);
router.use(orgsRouter);

export default router;
