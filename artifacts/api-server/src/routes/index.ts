import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import orgsRouter from "./orgs";
import billingRouter from "./billing";
import crmRouter from "./crm";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
// Specific org sub-resources must be mounted before the generic orgs router
// so their middleware chains (feature gates, role gates) apply.
router.use(billingRouter);
router.use(crmRouter);
router.use(dashboardRouter);
router.use(orgsRouter);

export default router;
