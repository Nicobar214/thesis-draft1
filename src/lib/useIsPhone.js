/* True while the screen is phone-sized (below Tailwind's md, 768 px), and it
 * follows rotation and window resizes. For layouts that cannot fit a phone at
 * all, such as a 7-column table, so a phone gets the card layout instead.
 *
 *   const isPhone = useIsPhone(); */
import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767px)';

export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return undefined;
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return isPhone;
}
