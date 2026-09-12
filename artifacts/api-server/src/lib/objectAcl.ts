import { File } from '@google-cloud/storage';
import { and, eq } from 'drizzle-orm';
import { db, users, orgUsers } from '@workspace/db';

const ACL_POLICY_METADATA_KEY = 'custom:aclPolicy';

// Can be flexibly defined according to the use case.
//
// Examples:
// - USER_LIST: the users from a list stored in the database;
// - EMAIL_DOMAIN: the users whose email is in a specific domain;
// - GROUP_MEMBER: the users who are members of a specific group;
// - SUBSCRIBER: the users who are subscribers of a specific service / content
//   creator.
export enum ObjectAccessGroupType {
  // Members of an organization (group id = org id). The userId checked is
  // the Clerk user id from the session.
  ORG_MEMBER = 'ORG_MEMBER',
}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  // The logic id that identifies qualified group members. Format depends on the
  // ObjectAccessGroupType — e.g. a user-list DB id, an email domain, a group id.
  id: string;
}

export enum ObjectPermission {
  READ = 'read',
  WRITE = 'write',
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// Stored as object custom metadata under "custom:aclPolicy" (JSON string).
export interface ObjectAclPolicy {
  owner: string;
  visibility: 'public' | 'private';
  aclRules?: Array<ObjectAclRule>;
}

export function organizationBindings(aclPolicy: ObjectAclPolicy): string[] {
  return [
    ...new Set(
      (aclPolicy.aclRules ?? [])
        .filter((rule) => rule.group.type === ObjectAccessGroupType.ORG_MEMBER)
        .map((rule) => rule.group.id),
    ),
  ];
}

export function isPrivatelyBoundOnlyToOrganization(
  aclPolicy: ObjectAclPolicy | null,
  orgId: string,
): boolean {
  if (!aclPolicy || aclPolicy.visibility !== "private") return false;
  const bindings = organizationBindings(aclPolicy);
  return bindings.length === 1 && bindings[0] === orgId;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

class OrgMemberAccessGroup extends BaseObjectAccessGroup {
  constructor(orgId: string) {
    super(ObjectAccessGroupType.ORG_MEMBER, orgId);
  }

  // userId here is the Clerk user id from the request session.
  async hasMember(clerkUserId: string): Promise<boolean> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId));
    if (!user) return false;
    const [membership] = await db
      .select({ id: orgUsers.id })
      .from(orgUsers)
      .where(and(eq(orgUsers.orgId, this.id), eq(orgUsers.userId, user.id)));
    return Boolean(membership);
  }
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    case ObjectAccessGroupType.ORG_MEMBER:
      return new OrgMemberAccessGroup(group.id);
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: File,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const [exists] = await objectFile.exists();
  if (!exists) {
    throw new Error(`Object not found: ${objectFile.name}`);
  }

  await objectFile.setMetadata({
    metadata: {
      [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
    },
  });
}

export async function getObjectAclPolicy(
  objectFile: File,
): Promise<ObjectAclPolicy | null> {
  const [metadata] = await objectFile.getMetadata();
  const aclPolicy = metadata?.metadata?.[ACL_POLICY_METADATA_KEY];
  if (!aclPolicy) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(aclPolicy as string);
    if (!parsed || typeof parsed !== 'object') return null;
    const value = parsed as {
      owner?: unknown;
      visibility?: unknown;
      aclRules?: unknown;
    };
    if (
      typeof value.owner !== 'string' ||
      (value.visibility !== 'public' && value.visibility !== 'private') ||
      (value.aclRules !== undefined && !Array.isArray(value.aclRules))
    ) {
      return null;
    }
    if (
      Array.isArray(value.aclRules) &&
      value.aclRules.some((rule) => {
        if (!rule || typeof rule !== 'object') return true;
        const group = (rule as { group?: unknown }).group;
        const permission = (rule as { permission?: unknown }).permission;
        return (
          !group ||
          typeof group !== 'object' ||
          (group as { type?: unknown }).type !== ObjectAccessGroupType.ORG_MEMBER ||
          typeof (group as { id?: unknown }).id !== 'string' ||
          (permission !== ObjectPermission.READ &&
            permission !== ObjectPermission.WRITE)
        );
      })
    ) {
      return null;
    }
    return parsed as ObjectAclPolicy;
  } catch {
    // Treat malformed metadata as an absent policy.  A corrupt ACL must fail
    // closed rather than turning a private-object GET into a server error.
    return null;
  }
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: File;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (
    aclPolicy.visibility === 'public' &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
