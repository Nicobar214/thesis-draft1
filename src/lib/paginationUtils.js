/**
 * Build a compact page-number list with ellipses for a pager.
 *
 * Always keeps the first and last page plus a window around the current page,
 * collapsing the gaps: getPaginationRange(5, 50) -> [1, '...', 4, 5, 6, '...', 50].
 * A single-page gap is filled with the page itself rather than '...'.
 *
 * Render the '...' entries as non-interactive spans.
 */
export function getPaginationRange(currentPage, totalPages) {
  const delta = 1;
  const range = [];
  const rangeWithDots = [];
  let l;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
      range.push(i);
    }
  }

  for (let i of range) {
    if (l) {
      if (i - l === 2) {
        rangeWithDots.push(l + 1);
      } else if (i - l > 2) {
        rangeWithDots.push('...');
      }
    }
    rangeWithDots.push(i);
    l = i;
  }

  return rangeWithDots;
}
