import express from 'express';
import cors from 'cors';
import { runMigrations } from './db/migrations.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Routes will be added here

async function start() {
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);
