/* TEMPORARY (testing): LGUs that handle citizen reports from every town, not
 * just their own. Matches supabase_lgu_testing_scope.sql, which grants the
 * same in the database. Set to [] (and run that file's REVERT block) after
 * testing. */
export const LGU_ALL_REGION_TEST_MUNICIPALITIES = ['leon'];

export function lguHandlesWholeRegion(municipality) {
  return LGU_ALL_REGION_TEST_MUNICIPALITIES.includes(String(municipality || '').trim().toLowerCase());
}
