import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit terminates requests at one controlled edge proxy. A hop-count policy
// prevents clients from selecting an arbitrary left-most X-Forwarded-For value.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// External Clerk deployments use the instance's configured publishable key.
app.use(
  clerkMiddleware({
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  }),
);

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const defaultCrmDistDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../crm/dist/public",
  );
  const crmDistDir = path.resolve(
    process.env.CRM_DIST_DIR ?? defaultCrmDistDir,
  );
  const crmIndexPath = path.join(crmDistDir, "index.html");

  if (!existsSync(crmIndexPath)) {
    throw new Error(
      `CRM production build not found at "${crmIndexPath}". Run the CRM build before starting the API server.`,
    );
  }

  app.use(express.static(crmDistDir, { index: false }));
  app.use((req, res, next) => {
    if (
      (req.method !== "GET" && req.method !== "HEAD") ||
      req.path.startsWith("/api/") ||
      req.path === "/api"
    ) {
      next();
      return;
    }

    res.sendFile(crmIndexPath);
  });
}

export default app;
