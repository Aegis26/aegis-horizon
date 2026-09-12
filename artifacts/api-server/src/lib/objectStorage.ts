import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import { File, Storage } from '@google-cloud/storage';
import { eq, inArray } from 'drizzle-orm';
import {
  db,
  organizationObjectBindings,
} from '@workspace/db';

import {
  canAccessObject,
  getObjectAclPolicy,
  isPrivatelyBoundOnlyToOrganization,
  organizationBindings,
  ObjectAccessGroupType,
  ObjectPermission,
  setObjectAclPolicy,
} from './objectAcl';

const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

export const objectStorageClient = new Storage({
  credentials: {
    audience: 'replit',
    subject_token_type: 'access_token',
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: 'external_account',
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: 'json',
        subject_token_field_name: 'access_token',
      },
    },
    universe_domain: 'googleapis.com',
  },
  projectId: '',
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const paths = Array.from(
      new Set(
        pathsStr
          .split(',')
          .map((path) => path.trim())
          .filter((path) => path.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          'tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths).',
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR?.trim() || '';
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }
    return dir;
  }

  hasPrivateObjectDir(): boolean {
    return Boolean(process.env.PRIVATE_OBJECT_DIR?.trim());
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === 'public';

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      'Content-Type':
        (metadata.contentType as string) || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers['Content-Length'] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          'tool and set PRIVATE_OBJECT_DIR env var.',
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: 'PUT',
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join('/');
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith('/')) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  /**
   * Deletes only an object whose private ACL explicitly binds it to this
   * organization.  Database references are treated as untrusted hints: a
   * corrupted or tampered row must never make this method delete another
   * tenant's object.
   */
  async deleteObjectEntityForOrganization(
    objectPath: string,
    orgId: string,
  ): Promise<void> {
    if (!objectPath.startsWith('/objects/')) {
      throw new Error('Invalid private object path');
    }
    const entityId = objectPath.slice('/objects/'.length);
    if (
      !entityId ||
      entityId.split('/').some((part) => !part || part === '.' || part === '..') ||
      entityId.includes('\\')
    ) {
      throw new Error('Invalid private object path');
    }
    const [authoritativeBinding] = await db
      .select({
        organizationId: organizationObjectBindings.organizationId,
      })
      .from(organizationObjectBindings)
      .where(eq(organizationObjectBindings.objectPath, objectPath));
    if (authoritativeBinding && authoritativeBinding.organizationId !== orgId) {
      throw new Error('Object is authoritatively bound to another organization');
    }

    let objectFile: File;
    try {
      objectFile = await this.getObjectEntityFile(objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return;
      throw error;
    }

    const aclPolicy = await getObjectAclPolicy(objectFile);
    const boundToOrganization = isPrivatelyBoundOnlyToOrganization(
      aclPolicy,
      orgId,
    );
    if (!boundToOrganization) {
      throw new Error('Object is not privately bound to this organization');
    }

    await objectFile.delete({ ignoreNotFound: true });
  }

  /**
   * Finds private objects that still carry this organization's ACL, including
   * uploaded objects whose logical database row was lost before association.
   * Objects without a valid org ACL are deliberately ignored.
   */
  async listObjectEntitiesForOrganization(orgId: string): Promise<string[]> {
    const privateDir = this.getPrivateObjectDir();
    const { bucketName, objectName } = parseObjectPath(privateDir);
    const prefix = objectName
      ? `${objectName.replace(/\/+$/, '')}/`
      : '';
    const [files] = await objectStorageClient
      .bucket(bucketName)
      .getFiles({ prefix });
    const paths: string[] = [];
    for (const file of files) {
      const aclPolicy = await getObjectAclPolicy(file);
      const boundToOrganization = isPrivatelyBoundOnlyToOrganization(
        aclPolicy,
        orgId,
      );
      if (!boundToOrganization) continue;
      const relative = objectName
        ? file.name.slice(`${objectName.replace(/\/+$/, '')}/`.length)
        : file.name;
      if (relative && !relative.includes('..')) {
        paths.push(`/objects/${relative}`);
      }
    }
    if (paths.length > 0) {
      const authoritativeBindings = await db
        .select({
          objectPath: organizationObjectBindings.objectPath,
          organizationId: organizationObjectBindings.organizationId,
        })
        .from(organizationObjectBindings)
        .where(inArray(organizationObjectBindings.objectPath, paths));
      const bindingByPath = new Map(
        authoritativeBindings.map((binding) => [
          binding.objectPath,
          binding.organizationId,
        ]),
      );
      for (const objectPath of paths) {
        const authoritativeOrgId = bindingByPath.get(objectPath);
        if (authoritativeOrgId && authoritativeOrgId !== orgId) {
          throw new Error('Object is authoritatively bound to another organization');
        }
      }
    }
    return paths;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith('https://storage.googleapis.com/')) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith('/')) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  /**
   * Binds an uploaded object exactly once. Existing metadata is never
   * overwritten: a path already bound to another owner or organization, or
   * ambiguously bound to multiple organizations, is rejected.
   */
  async bindObjectEntityToOrganization(
    rawPath: string,
    orgId: string,
    clerkUserId: string,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/objects/')) {
      throw new Error('Invalid private object path');
    }
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    return db.transaction(async (tx) => {
      const [binding] = await tx
        .select()
        .from(organizationObjectBindings)
        .where(eq(organizationObjectBindings.objectPath, normalizedPath))
        .for('update');
      if (binding) {
        if (
          binding.organizationId !== orgId ||
          binding.ownerUserId !== clerkUserId
        ) {
          throw new Error('Object is already bound to a different owner or organization');
        }
        const existing = await getObjectAclPolicy(objectFile);
        if (!isPrivatelyBoundOnlyToOrganization(existing, orgId) ||
            existing?.owner !== clerkUserId) {
          throw new Error('Object ACL binding is invalid or ambiguous');
        }
        return normalizedPath;
      }

      const existing = await getObjectAclPolicy(objectFile);
      if (existing) {
        const boundOrganizationIds = organizationBindings(existing);
        if (
          existing.visibility !== 'private' ||
          boundOrganizationIds.length !== 1 ||
          boundOrganizationIds[0] !== orgId ||
          existing.owner !== clerkUserId
        ) {
          throw new Error('Object is already bound to a different owner or organization');
        }
      }

      await tx.insert(organizationObjectBindings).values({
        id: randomUUID(),
        objectPath: normalizedPath,
        organizationId: orgId,
        ownerUserId: clerkUserId,
      });
      if (!existing) {
        await setObjectAclPolicy(objectFile, {
          owner: clerkUserId,
          visibility: 'private',
          aclRules: [
            {
              group: { type: ObjectAccessGroupType.ORG_MEMBER, id: orgId },
              permission: ObjectPermission.READ,
            },
          ],
        });
      }
      return normalizedPath;
    });
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  const pathParts = path.split('/');
  if (pathParts.length < 3) {
    throw new Error('Invalid path: must contain at least a bucket name');
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join('/');

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`,
    );
  }

  const { signed_url: signedURL } = (await response.json()) as {
    signed_url: string;
  };
  return signedURL;
}
