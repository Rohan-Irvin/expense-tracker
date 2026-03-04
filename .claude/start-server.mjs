import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..', 'server');

// tsx.cmd is installed locally in the server's node_modules
const tsxCmd = path.join(serverDir, 'node_modules', '.bin', 'tsx.cmd');

// .cmd files on Windows must be invoked via cmd.exe
const proc = spawn('cmd.exe', ['/c', tsxCmd, 'watch', 'src/index.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  shell: false,
});

proc.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

proc.on('exit', (code) => {
  process.exit(code ?? 0);
});
