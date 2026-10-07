/** Shared rules for "I see this too" on community road reports. */

/** Only open reports can be backed; the database enforces the same rule. */
export const SUPPORTABLE_STATUSES = ['pending', 'reviewed'];

export function supportCountLabel(count) {
  if (!count) return null;
  return count === 1 ? '1 resident sees this too' : `${count} residents see this too`;
}
