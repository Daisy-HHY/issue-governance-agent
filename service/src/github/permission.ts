const DEFAULT_ALLOWED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export interface TriggerPermissionInput {
  author: string;
  authorAssociation?: string;
  allowedUsers?: string[];
  allowedAssociations?: string[];
}

/**
 * Checks whether a GitHub commenter can trigger issue governance.
 */
export function canTriggerGovernance(input: TriggerPermissionInput): boolean {
  const allowedUsers = new Set((input.allowedUsers ?? []).map((user) => user.toLowerCase()));
  const allowedAssociations =
    input.allowedAssociations && input.allowedAssociations.length > 0
      ? new Set(input.allowedAssociations.map((association) => association.toUpperCase()))
      : DEFAULT_ALLOWED_ASSOCIATIONS;

  return (
    allowedUsers.has(input.author.toLowerCase()) ||
    allowedAssociations.has((input.authorAssociation ?? "").toUpperCase())
  );
}
