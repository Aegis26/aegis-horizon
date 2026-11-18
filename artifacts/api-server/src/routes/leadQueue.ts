import { Router, type IRouter } from "express";
import { z } from "zod";
import { ActOnLeadQueueBody, ActOnLeadQueueResponse, ListLeadQueueQueryParams, ListLeadQueueResponse } from "@workspace/api-zod";
import { attachUser, attachOrg, requireFeature } from "../middlewares/auth";
import { actOnQueue, listQueue, QueueError } from "../services/leadQueue";

const router: IRouter = Router();
const path = "/orgs/:orgId/lead-queue";
router.get(path, attachUser, attachOrg, requireFeature("sales"), async (req, res): Promise<void> => {
  const parsed = ListLeadQueueQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({error: "Invalid queue filters"}); return; }
  try {
    res.json(ListLeadQueueResponse.parse(await listQueue(req.currentOrg!.id, req.currentMembership!.role, parsed.data.status ?? "queued")));
  } catch (error) {
    if (error instanceof QueueError) { res.status(error.status).json({error: error.message}); return; }
    throw error;
  }
});
router.post(`${path}/:leadId/actions`,
  (_req, res, next) => { res.locals.allowLeadQueueViewerAction = true; next(); },
  attachUser, attachOrg, requireFeature("sales"),
  async (req, res): Promise<void> => {
    const parsed = ActOnLeadQueueBody.strict().safeParse(req.body);
    const id = z.string().uuid().safeParse(req.params.leadId);
    if (!parsed.success || !id.success) { res.status(400).json({error: "Invalid queue action"}); return; }
    try {
      res.json(ActOnLeadQueueResponse.parse(await actOnQueue(
        req.currentOrg!.id, req.currentUser!.id, req.currentMembership!.role, id.data, parsed.data,
      )));
    } catch (error) {
      if (error instanceof QueueError) { res.status(error.status).json({error: error.message}); return; }
      throw error;
    }
  });
export default router;
