import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { expenses as expensesApi } from '@/api/client';

interface QCCountCtx {
  count: number;
  refresh: () => void;
}

const QCCountContext = createContext<QCCountCtx>({ count: 0, refresh: () => {} });

export function QCCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    expensesApi.qcCount()
      .then((r) => setCount(r.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <QCCountContext.Provider value={{ count, refresh }}>
      {children}
    </QCCountContext.Provider>
  );
}

export const useQCCount = () => useContext(QCCountContext);
