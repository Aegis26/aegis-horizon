import { Router, type IRouter } from "express";
import {
  DeleteUserAccountResponse,
} from "@workspace/api-zod";
import { attachUser } from "../middlewares/auth";
import { parseExactAccountDeletionBody } from "./accountDeletionContract";
import {
  AccountDeletionError,
  deleteAccount,
} from "../services/accountDeletion";

const router: IRouter = Router();

/**
 * Self-account deletion. Identity is derived only from the authenticated Clerk
 * session; the request body is a confirmation token, never a user identifier.
 */
router.delete(
  "/users/delete-account",
  attachUser,
  async (req, res): Promise<void> => {
    if (!parseExactAccountDeletionBody(req.body)) {
      res.status(400).json({ error: 'Type "DELETE" in the confirmation field' });
      return;
    }

    try {
      await deleteAccount(req.currentUser!.id);
      res.json(DeleteUserAccountResponse.parse({ success: true }));
    } catch (error) {
      if (error instanceof AccountDeletionError) {
        if (error.code === "not_found") {
          res.status(404).json({ error: "User not found" });
          return;
        }
        if (
          error.code === "in_progress" ||
          error.code === "organization_in_progress"
        ) {
          res.status(409).json({ error: "Account deletion is already in progress" });
          return;
        }
        if (error.code === "clerk_delete_failed") {
          res.status(502).json({
            error: "Account deletion was not completed. Retry is safe.",
          });
          return;
        }
        res.status(500).json({
          error: "Account deletion was not completed. Retry is safe.",
        });
        return;
      }
      throw error;
    }
  },
);

export default router;