import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "owner",
  "admin",
  "manager",
  "user",
  "viewer",
]);

export const planTypeEnum = pgEnum("plan_type", [
  "essential",
  "professional",
  "enterprise",
  "custom",
]);

export const recordStatusEnum = pgEnum("record_status", [
  "active",
  "inactive",
  "archived",
]);
