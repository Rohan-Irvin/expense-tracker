import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/migrations.js';
import categoriesRouter from './routes/categories.js';
import accountsRouter from './routes/accounts.js';
import settingsRouter from './routes/settings.js';
import importRouter from './routes/import.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/categories', categoriesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', importRouter);

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
