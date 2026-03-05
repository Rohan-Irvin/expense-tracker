import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/migrations.js';
import categoriesRouter from './routes/categories.js';
import accountsRouter from './routes/accounts.js';
import settingsRouter from './routes/settings.js';
import importRouter from './routes/import.js';
import amazonRouter from './routes/amazon.js';
import incomeRouter from './routes/income.js';
import incomeCategoriesRouter from './routes/income-categories.js';
import expensesRouter from './routes/expenses.js';
import dashboardRouter from './routes/dashboard.js';
import merchantRulesRouter from './routes/merchantRules.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/categories', categoriesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', importRouter);
app.use('/api/amazon', amazonRouter);
app.use('/api/income', incomeRouter);
app.use('/api/income-categories', incomeCategoriesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/merchant-rules', merchantRulesRouter);

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
