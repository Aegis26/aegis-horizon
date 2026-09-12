import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, exists, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import PDFDocument from "pdfkit";
import { getAuth } from "@clerk/express";
import { accounts, db, documents, documentVersions, opportunities, signatureAuditEvents, signatureRequests, signatureSigners } from "@workspace/db";
import {
  attachOrg,
  attachUser,
  acquireOrganizationMutationLock,
  requireRole,
} from "../middlewares/auth";
import { ObjectAccessGroupType, ObjectPermission } from "../lib/objectAcl";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";
import { sendEmail } from "../lib/email";
import { appendAuditEvent, auditContext } from "../services/audit";
import { getClientIp } from "../lib/clientIp";
import { hasCrmManagementAccess, withCrmVisibility } from "../services/crmAccess";

const router: IRouter = Router(); const gate = [attachUser, attachOrg, requireRole("viewer")] as const;
const upload = z.object({ objectPath: z.string().regex(/^\/objects\/uploads\/[a-z0-9-]+$/), fileName: z.string().min(1).max(255), contentType: z.enum(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"]), sizeBytes: z.number().int().positive().max(25 * 1024 * 1024) }).strict();
const create = z.object({ name: z.string().min(1).max(255), description: z.string().max(2000).optional(), accountId: z.string().uuid().optional(), opportunityId: z.string().uuid().optional(), signatureFields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), page: z.number().int().min(1), required: z.boolean().default(true) }).strict()).max(50).default([]), upload }).strict();
/**
 * Documents do not have an owner column of their own.  A document is a
 * derived/child record, so every populated account/opportunity parent must be
 * visible. An entirely unlinked document remains available to its creator for
 * regular users. Viewers are intentionally limited to currently-owned CRM
 * parents and do not receive creator access.
 */
export function documentVisibility(req: Request): SQL | undefined {
  if (hasCrmManagementAccess(req)) return undefined;

  const accountAccess = exists(
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(
        eq(accounts.id, documents.accountId),
        eq(accounts.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
      )),
  );
  const opportunityAccess = exists(
    db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(
        eq(opportunities.id, documents.opportunityId),
        eq(opportunities.orgId, req.currentOrg!.id),
        ...withCrmVisibility(req, opportunities.ownerUserId, opportunities.createdByUserId),
        exists(
          db
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(
              eq(accounts.id, opportunities.accountId),
              eq(accounts.orgId, req.currentOrg!.id),
              ...withCrmVisibility(req, accounts.ownerUserId, accounts.createdByUserId),
            )),
        ),
      )),
  );

  // A linked document is visible only when every populated parent is
  // visible. Null parent links are intentionally treated as not applicable.
  const allLinkedParentsVisible = and(
    or(isNull(documents.accountId), accountAccess),
    or(isNull(documents.opportunityId), opportunityAccess),
    or(isNotNull(documents.accountId), isNotNull(documents.opportunityId)),
  )!;
  if (req.currentMembership?.role === "viewer") {
    return allLinkedParentsVisible;
  }

  // Creator access is only an ownership fallback for a document with no CRM
  // parent. It must not bypass a hidden account or opportunity.
  return or(
    and(
      isNull(documents.accountId),
      isNull(documents.opportunityId),
      eq(documents.createdByUserId, req.currentUser!.id),
    ),
    allLinkedParentsVisible,
  )!;
}

async function owned(req: Request) {
  const visibility = documentVisibility(req);
  const where = [
    eq(documents.id, req.params.documentId as string),
    eq(documents.orgId, req.currentOrg!.id),
    ...(visibility ? [visibility] : []),
  ];
  const [document] = await db.select().from(documents).where(and(...where));
  return document;
}
async function bind(path: string, orgId: string, clerkId: string) {
  return new ObjectStorageService().bindObjectEntityToOrganization(path, orgId, clerkId);
}
async function signedCertificate(input: { orgId: string; documentId: string; sourceVersion: number; sourcePath: string; requestId: string; signers: typeof signatureSigners.$inferSelect[]; auditIds: string[] }) {
  const text = [
    "Aegis Horizon — Signed Document Certificate", `Document ID: ${input.documentId}`, `Source version: ${input.sourceVersion}`,
    `Original object: ${input.sourcePath}`, `Signature request: ${input.requestId}`, `Audit event IDs: ${input.auditIds.join(", ")}`,
    ...input.signers.map((s) => `Signer: ${s.name} <${s.email}> | typed signature: ${(s.signatureData as { typedSignature?: string } | null)?.typedSignature ?? ""} | consented/signed: ${s.signedAt?.toISOString() ?? ""} | IP: ${s.signingIp ?? ""}`),
  ].join("\n");
  const bytes = await new Promise<Buffer>((resolve, reject) => { const pdf = new PDFDocument(); const chunks: Buffer[] = []; pdf.on("data", (chunk: Buffer) => chunks.push(chunk)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject); pdf.fontSize(15).text("SIGNED DOCUMENT CERTIFICATE"); pdf.moveDown(); pdf.fontSize(9).text(text); pdf.end(); });
  const digest = createHash("sha256").update(bytes).digest("hex"); const relative = `signed/${input.orgId}/${randomUUID()}.pdf`;
  const parts = new ObjectStorageService().getPrivateObjectDir().replace(/^\//, "").split("/"); const bucket = parts.shift(); if (!bucket) throw new Error("Invalid private object storage directory");
  const object = objectStorageClient.bucket(bucket).file([...parts, relative].join("/"));
  await object.save(bytes, { contentType: "application/pdf", resumable: false });
  await object.setMetadata({ metadata: { "custom:aclPolicy": JSON.stringify({ owner: "signature-system", visibility: "private", aclRules: [{ group: { type: ObjectAccessGroupType.ORG_MEMBER, id: input.orgId }, permission: ObjectPermission.READ }] }) } });
  return { objectPath: `/objects/${relative}`, sizeBytes: bytes.length, sha256: digest };
}

router.get("/orgs/:orgId/documents", ...gate, async (req, res) => {
  const visibility = documentVisibility(req);
  const where = [
    eq(documents.orgId, req.currentOrg!.id),
    isNull(documents.archivedAt),
    ...(visibility ? [visibility] : []),
  ];
  res.json(await db.select().from(documents).where(and(...where)).orderBy(desc(documents.updatedAt)));
});
router.post("/orgs/:orgId/documents", ...gate, async (req, res): Promise<void> => {
  const parsed = create.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; } const value = parsed.data; const orgId = req.currentOrg!.id;
  if (value.accountId && !(await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, value.accountId), eq(accounts.orgId, orgId)))).length) { res.status(400).json({ error: "accountId must belong to this organization" }); return; }
  if (value.opportunityId && !(await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.id, value.opportunityId), eq(opportunities.orgId, orgId)))).length) { res.status(400).json({ error: "opportunityId must belong to this organization" }); return; }
  const clerkId = getAuth(req).userId!; let path: string;
  try { path = await bind(value.upload.objectPath, orgId, clerkId); } catch { res.status(400).json({ error: "Uploaded object was not found" }); return; }
  const [document] = await db.transaction(async (tx) => {
    const [doc] = await tx.insert(documents).values({ orgId, name: value.name, description: value.description, accountId: value.accountId, opportunityId: value.opportunityId, signatureFields: value.signatureFields, currentVersion: 1, createdByUserId: req.currentUser!.id }).returning();
    await tx.insert(documentVersions).values({ orgId, documentId: doc.id, version: 1, objectPath: path, fileName: value.upload.fileName, contentType: value.upload.contentType, sizeBytes: value.upload.sizeBytes, createdByUserId: req.currentUser!.id }); return [doc];
  });
  await appendAuditEvent({ orgId, action: "document.created", entityType: "document", entityId: document.id, ...auditContext(req) }); res.status(201).json(document);
});
router.get("/orgs/:orgId/documents/:documentId", ...gate, async (req, res): Promise<void> => { const doc = await owned(req); if (!doc) { res.status(404).json({ error: "Document not found" }); return; } const versions = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.orgId, doc.orgId))).orderBy(desc(documentVersions.version)); res.json({ ...doc, versions }); });
router.get("/orgs/:orgId/documents/:documentId/download", ...gate, async (req, res): Promise<void> => { const doc = await owned(req); if (!doc) { res.status(404).json({ error: "Document not found" }); return; } const [version] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.orgId, doc.orgId), eq(documentVersions.version, doc.currentVersion))); if (!version) { res.status(404).json({ error: "Version not found" }); return; } res.redirect(302, `/api/storage${version.objectPath}`); });
router.post("/orgs/:orgId/documents/:documentId/versions", ...gate, async (req, res): Promise<void> => { const doc = await owned(req); const parsed = upload.safeParse(req.body); if (!doc) { res.status(404).json({ error: "Document not found" }); return; } if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; } let path: string; try { path = await bind(parsed.data.objectPath, doc.orgId, getAuth(req).userId!); } catch { res.status(400).json({ error: "Uploaded object was not found" }); return; } const [version] = await db.transaction(async (tx) => { const next = doc.currentVersion + 1; const [created] = await tx.insert(documentVersions).values({ orgId: doc.orgId, documentId: doc.id, version: next, objectPath: path, fileName: parsed.data.fileName, contentType: parsed.data.contentType, sizeBytes: parsed.data.sizeBytes, createdByUserId: req.currentUser!.id }).returning(); await tx.update(documents).set({ currentVersion: next }).where(eq(documents.id, doc.id)); return [created]; }); res.status(201).json(version); });

router.post("/orgs/:orgId/documents/:documentId/signature-requests", ...gate, async (req, res): Promise<void> => {
  const doc = await owned(req);
  const parsed = z.object({
    signers: z.array(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      signingOrder: z.number().int().min(0).optional(),
    })).min(1).max(20),
    expiresAt: z.string().datetime().optional(),
    message: z.string().max(2000).optional(),
  }).safeParse(req.body);
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
  const [version] = await db.select().from(documentVersions).where(and(eq(documentVersions.documentId, doc.id), eq(documentVersions.version, doc.currentVersion)));
  if (!version) { res.status(409).json({ error: "Document has no current version" }); return; }

  const [request] = await db.insert(signatureRequests).values({
    orgId: doc.orgId,
    documentId: doc.id,
    documentVersionId: version.id,
    message: parsed.data.message,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    createdByUserId: req.currentUser!.id,
  }).returning();
  const configuredAppUrl = process.env.APP_URL?.trim().replace(/\/+$/, "");
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const issued: { email: string; signingUrl: string; notificationStatus: "sent" | "failed" | "not_configured" }[] = [];

  for (const signer of parsed.data.signers) {
    const token = randomBytes(32).toString("base64url");
    const [row] = await db.insert(signatureSigners).values({
      orgId: doc.orgId,
      signatureRequestId: request.id,
      name: signer.name,
      email: signer.email,
      signingOrder: signer.signingOrder,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    }).returning();
    const signingPath = `/signatures/${token}`;
    const url = configuredAppUrl ? `${configuredAppUrl}${signingPath}` : domain ? `https://${domain}${signingPath}` : signingPath;
    let notificationStatus: "sent" | "failed" | "not_configured" = "not_configured";
    if (domain && process.env.RESEND_API_KEY) {
      try {
        await sendEmail({
          to: signer.email,
          subject: `Signature requested: ${doc.name}`,
          html: `<p>${parsed.data.message ?? "Please review and sign the document."}</p><p><a href="${url}">Review and sign</a></p>`,
        });
        notificationStatus = "sent";
      } catch (error) {
        req.log.warn({ err: error, signerId: row.id }, "Signature notification delivery failed");
        notificationStatus = "failed";
      }
    }
    issued.push({ email: signer.email, signingUrl: url, notificationStatus });
    await db.insert(signatureAuditEvents).values({
      orgId: doc.orgId,
      signatureRequestId: request.id,
      signerId: row.id,
      eventType: notificationStatus === "sent" ? "sent" : "created",
      metadata: { notificationStatus },
    });
  }
  res.status(201).json({ request, signingLinks: issued });
});
router.get("/signatures/:token", async (req, res): Promise<void> => { const hash = createHash("sha256").update(req.params.token as string).digest("hex"); const [signer] = await db.select().from(signatureSigners).where(eq(signatureSigners.tokenHash, hash)); if (!signer) { res.status(404).json({ error: "Signature request not found" }); return; } const [request] = await db.select().from(signatureRequests).where(and(eq(signatureRequests.id, signer.signatureRequestId), eq(signatureRequests.status, "pending"))); if (!request || (request.expiresAt && request.expiresAt < new Date())) { res.status(410).json({ error: "Signature request expired or unavailable" }); return; } if (!(await acquireOrganizationMutationLock(req, res, signer.orgId))) return; await db.update(signatureSigners).set({ viewedAt: signer.viewedAt ?? new Date() }).where(eq(signatureSigners.id, signer.id)); res.json({ signer: { name: signer.name, email: signer.email }, request: { id: request.id, message: request.message, expiresAt: request.expiresAt } }); });
router.post("/signatures/:token/complete", async (req, res): Promise<void> => {
  const parsed = z.object({ typedSignature: z.string().min(1).max(200), consent: z.literal(true) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Typed signature and consent are required" }); return; }
  const hash = createHash("sha256").update(req.params.token as string).digest("hex"); const now = new Date();
  const [targetSigner] = await db.select({ orgId: signatureSigners.orgId }).from(signatureSigners).where(and(eq(signatureSigners.tokenHash, hash), eq(signatureSigners.status, "pending")));
  if (targetSigner && !(await acquireOrganizationMutationLock(req, res, targetSigner.orgId))) return;
  const [signer] = await db.update(signatureSigners).set({ status: "signed", signedAt: now, signingIp: getClientIp(req), userAgent: req.get("user-agent")?.slice(0, 1000), signatureData: { typedSignature: parsed.data.typedSignature, consent: true } }).where(and(eq(signatureSigners.tokenHash, hash), eq(signatureSigners.status, "pending"))).returning();
  if (!signer) { res.status(409).json({ error: "Signature link is invalid or already used" }); return; }
  const [request] = await db.select().from(signatureRequests).where(eq(signatureRequests.id, signer.signatureRequestId));
  if (!request || (request.expiresAt && request.expiresAt < now)) { res.status(410).json({ error: "Signature request expired" }); return; }
  const [signatureAudit] = await db.insert(signatureAuditEvents).values({ orgId: signer.orgId, signatureRequestId: request.id, signerId: signer.id, eventType: "signed", ipAddress: getClientIp(req), userAgent: req.get("user-agent")?.slice(0, 1000), metadata: { consent: true } }).returning();
  const allSigners = await db.select().from(signatureSigners).where(eq(signatureSigners.signatureRequestId, request.id));
  if (allSigners.some((item) => item.status !== "signed")) { res.json({ status: "pending", remainingSigners: allSigners.filter((item) => item.status !== "signed").length }); return; }
  const [source] = await db.select().from(documentVersions).where(eq(documentVersions.id, request.documentVersionId));
  const [document] = await db.select().from(documents).where(and(eq(documents.id, request.documentId), eq(documents.orgId, signer.orgId)));
  if (!source || !document) { res.status(409).json({ error: "Signature source document is unavailable" }); return; }
  const [audit] = await db.insert(signatureAuditEvents).values({ orgId: signer.orgId, signatureRequestId: request.id, eventType: "completed", metadata: { signerCount: allSigners.length } }).returning();
  const certificate = await signedCertificate({ orgId: signer.orgId, documentId: document.id, sourceVersion: source.version, sourcePath: source.objectPath, requestId: request.id, signers: allSigners, auditIds: [signatureAudit.id, audit.id] });
  const [version] = await db.transaction(async (tx) => {
    const next = document.currentVersion + 1;
    const [created] = await tx.insert(documentVersions).values({ orgId: signer.orgId, documentId: document.id, version: next, objectPath: certificate.objectPath, fileName: `${document.name}-signed-certificate.pdf`, contentType: "application/pdf", sizeBytes: certificate.sizeBytes, sha256: certificate.sha256, source: "signature", createdByUserId: null }).returning();
    await tx.update(documents).set({ currentVersion: next, status: "signed" }).where(and(eq(documents.id, document.id), eq(documents.currentVersion, document.currentVersion)));
    await tx.update(signatureRequests).set({ status: "signed", completedAt: now, signedDocumentVersionId: created.id }).where(eq(signatureRequests.id, request.id));
    return [created];
  });
  await appendAuditEvent({ orgId: signer.orgId, action: "signature.completed", entityType: "signature_request", entityId: request.id, ipAddress: getClientIp(req), userAgent: req.get("user-agent")?.slice(0, 1000), metadata: { signedVersionId: version.id, certificateSha256: certificate.sha256 } });
  res.json({ status: "signed", signedDocumentVersionId: version.id });
});
export default router;