import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(__dirname, '..', 'client');

process.chdir(clientDir);

const vite = await import(pathToFileURL(path.join(clientDir, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);

const server = await vite.createServer({
  configFile: path.join(clientDir, 'vite.config.ts'),
  root: clientDir,
});
await server.listen();
server.printUrls();
