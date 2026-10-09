import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads .env from the nearest parent directory into process.env
 * utilizing Node.js 20.12+ native process.loadEnvFile.
 */
export function loadEnv(startDir: string = process.cwd()): void {
  if (typeof (process as any).loadEnvFile !== 'function') {
    return;
  }

  let dir = path.resolve(startDir);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      try {
        (process as any).loadEnvFile(candidate);
      } catch {
        // Ignore unreadable or duplicate env file errors
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
