export const DELETE_ORGANIZATION_CONFIRMATION = {
  confirmation: "DELETE",
} as const;

export function isDeleteOrganizationConfirmation(value: string): boolean {
  return value === DELETE_ORGANIZATION_CONFIRMATION.confirmation;
}