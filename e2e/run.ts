import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const testPort = 4184;
const testUrl = `http://127.0.0.1:${testPort}`;
const testDataDirectory = await mkdtemp(path.join(os.tmpdir(), 'livewall-e2e-'));
const server = spawn(process.execPath, [path.join(root, 'dist-server/server/index.js')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    PORT: String(testPort),
    LIVEWALL_TEST_WALL_CONTROL: '1',
    LIVEWALL_DATA_DIR: testDataDirectory,
  },
});

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${testUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('LiveWall test server did not become ready.');
}

let exitCode: number;
try {
  await waitForServer();
  const runner = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/@playwright/test/cli.js'),
      'test',
      '--config=playwright.config.ts',
    ],
    {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, LIVEWALL_TEST_URL: testUrl },
    },
  );
  exitCode = await new Promise<number>((resolve) =>
    runner.once('exit', (code) => resolve(code ?? 1)),
  );
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
  await rm(testDataDirectory, { recursive: true, force: true });
}

process.exitCode = exitCode;
