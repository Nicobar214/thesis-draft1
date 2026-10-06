import { createContext, useContext } from 'react';

/** The contractor's summary, fetched once by ContractorLayout and read by the sidebar and the page. */
export const ContractorSummaryContext = createContext(null);

export function useContractorSummaryContext() {
  const value = useContext(ContractorSummaryContext);
  if (!value) throw new Error('useContractorSummaryContext must be used inside ContractorLayout');
  return value;
}
