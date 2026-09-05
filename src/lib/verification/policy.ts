export const MIN_TARGET_FOLLOWERS = 10_000;
export const MAX_TARGET_FOLLOWERS_EXCLUSIVE = 100_000;

export function getFollowerPolicyRejection(followers: number | null) {
  if (followers === null) return null;
  if (followers < MIN_TARGET_FOLLOWERS) return "under_min" as const;
  if (followers >= MAX_TARGET_FOLLOWERS_EXCLUSIVE) return "over_max" as const;
  return null;
}
