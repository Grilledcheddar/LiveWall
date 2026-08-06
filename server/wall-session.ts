import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WallActionResult {
  Ok: boolean;
  Status: string;
  Message: string;
  ProcessId?: number;
  Display?: string;
}

export type WallAction = 'status' | 'close' | 'open';
export type WallActionRunner = (action: WallAction) => Promise<WallActionResult>;

export class WallSessionService {
  private testStatus = 'open';

  constructor(
    private readonly root: string,
    private readonly runner?: WallActionRunner,
  ) {}

  async run(action: WallAction): Promise<WallActionResult> {
    if (this.runner) return this.runner(action);
    if (process.env.LIVEWALL_TEST_WALL_CONTROL === '1') {
      if (action === 'status')
        return { Ok: true, Status: this.testStatus, Message: `Wall is ${this.testStatus}.` };
      if (action === 'close') {
        if (this.testStatus === 'closed')
          return {
            Ok: true,
            Status: 'already-closed',
            Message: 'The dedicated Wall is already closed.',
          };
        this.testStatus = 'closed';
        return { Ok: true, Status: 'closed', Message: 'The dedicated Wall was closed.' };
      }
      this.testStatus = 'open';
      return {
        Ok: true,
        Status: 'opened',
        Message: 'The dedicated Wall opened on Monitor 2.',
        Display: '\\\\.\\DISPLAY2',
      };
    }
    const script = path.join(this.root, 'launcher', 'manage-wall.ps1');
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    try {
      const { stdout } = await execFileAsync(
        powershell,
        [
          '-NoLogo',
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          script,
          '-Action',
          action,
          '-Root',
          this.root,
        ],
        { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 },
      );
      return parseWallResult(stdout);
    } catch (error) {
      const stdout =
        typeof error === 'object' && error && 'stdout' in error ? String(error.stdout) : '';
      if (stdout.trim()) return parseWallResult(stdout);
      throw error;
    }
  }
}

export function parseWallResult(output: string): WallActionResult {
  const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('The Wall launcher did not return a status result.');
  const parsed = JSON.parse(line) as Partial<WallActionResult>;
  if (
    typeof parsed.Ok !== 'boolean' ||
    typeof parsed.Status !== 'string' ||
    typeof parsed.Message !== 'string'
  ) {
    throw new Error('The Wall launcher returned an invalid status result.');
  }
  return parsed as WallActionResult;
}
