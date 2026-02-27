import { createClient } from '@libsql/client';

const db = createClient({
  url: 'file:./data/expenses.db',
});

export default db;
