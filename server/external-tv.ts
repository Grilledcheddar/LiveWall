import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { detectSource } from '../src/lib/sources.js';

export type ExternalViewMode =
  'fullscreen' | 'wall-top' | 'external-top' | 'external-left' | 'wall-left' | 'overlay';
export type SplitRatio = 65 | 60 | 50;

const execFileAsync = promisify(execFile);
export type ExternalTvPhase =
  'wall-active' | 'preparing' | 'external-active' | 'restoring' | 'failed';
export interface ExternalTvStatus {
  phase: ExternalTvPhase;
  message: string;
  url?: string;
  fallbackUsed?: boolean;
}
interface LauncherResult {
  Ok: boolean;
  Status: string;
  Message: string;
  Url?: string;
  FallbackUsed?: boolean;
}

export class ExternalTvService {
  private status: ExternalTvStatus = { phase: 'wall-active', message: 'LiveWall Wall is active.' };
  private testExternalOpen = false;
  constructor(
    private readonly root: string,
    private readonly runner?: (
      action: 'open' | 'close' | 'status',
      url?: string,
      mode?: ExternalViewMode,
      ratio?: SplitRatio,
    ) => Promise<LauncherResult>,
    private readonly wall?: (
      action: 'open' | 'close',
      mode?: ExternalViewMode,
      ratio?: SplitRatio,
    ) => Promise<LauncherResult>,
  ) {}
  get() {
    return { ...this.status };
  }
  async refresh() {
    let result: LauncherResult;
    try {
      result = await this.run('status');
    } catch {
      // Chromium can hand a visible window between processes while it starts.
      // A failed probe is not evidence that the exact dedicated session closed;
      // keep the current state until a later successful probe says it is closed.
      return this.get();
    }
    if (this.status.phase === 'wall-active' && result.Status === 'active') {
      this.status = {
        phase: 'external-active',
        message: result.Message,
        url: result.Url,
        fallbackUsed: result.FallbackUsed,
      };
      return this.get();
    }
    if (this.status.phase !== 'external-active') return this.get();
    if (result.Status === 'closed')
      await this.restore('External TV window closed. LiveWall Wall restored.');
    return this.get();
  }
  async open(rawUrl: string, mode: ExternalViewMode = 'fullscreen', ratio: SplitRatio = 65) {
    const source = detectSource(rawUrl);
    if (!['http:', 'https:'].includes(new URL(source.url).protocol))
      throw new Error('Only http:// and https:// URLs are allowed.');
    if (this.status.phase === 'external-active') return this.get();
    if (this.status.phase === 'preparing' || this.status.phase === 'restoring') return this.get();
    this.status = { phase: 'preparing', message: 'Preparing the dedicated External TV window.' };
    try {
      const closed = await this.runWall('close');
      if (!closed.Ok && closed.Status !== 'already-closed') throw new Error(closed.Message);
      if (mode !== 'fullscreen') {
        const wall = await this.runWall('open', mode, ratio);
        if (!wall.Ok && wall.Status !== 'already-open') throw new Error(wall.Message);
      }
      const opened = await this.run('open', source.url, mode, ratio);
      if (!opened.Ok) {
        await this.runWall('open');
        throw new Error(opened.Message);
      }
      this.status = {
        phase: 'external-active',
        message: opened.Message,
        url: source.url,
        fallbackUsed: opened.FallbackUsed,
      };
    } catch (error) {
      this.status = {
        phase: 'failed',
        message: error instanceof Error ? error.message : 'External TV could not be opened.',
      };
    }
    return this.get();
  }
  async restore(message = 'LiveWall Wall restored.') {
    if (this.status.phase === 'wall-active') return this.get();
    this.status = { phase: 'restoring', message: 'Restoring LiveWall Wall.' };
    let closed: LauncherResult;
    try {
      closed = await this.run('close');
    } catch (error) {
      // Chrome can complete its own close before the launcher returns. Confirm only the exact
      // dedicated session is closed before restoring the Wall; never infer this from broad browser state.
      closed = await this.run('status');
      if (closed.Status !== 'closed') throw error;
    }
    if (!closed.Ok && closed.Status !== 'already-closed') {
      this.status = { phase: 'failed', message: closed.Message };
      return this.get();
    }
    // A split Wall is still a valid dedicated Wall session. Close that exact
    // session first so the normal fullscreen/kiosk launch cannot be mistaken
    // for an already-open split instance.
    const closedWall = await this.runWall('close');
    if (!closedWall.Ok && closedWall.Status !== 'already-closed') {
      this.status = { phase: 'failed', message: closedWall.Message };
      return this.get();
    }
    const opened = await this.runWall('open');
    this.status =
      opened.Ok || opened.Status === 'already-open'
        ? { phase: 'wall-active', message }
        : { phase: 'failed', message: opened.Message };
    return this.get();
  }
  private async run(
    action: 'open' | 'close' | 'status',
    url?: string,
    mode?: ExternalViewMode,
    ratio?: SplitRatio,
  ): Promise<LauncherResult> {
    if (this.runner) return this.runner(action, url, mode, ratio);
    if (process.env.LIVEWALL_TEST_WALL_CONTROL === '1') {
      if (action === 'open') this.testExternalOpen = true;
      if (action === 'close') this.testExternalOpen = false;
      return {
        Ok: true,
        Status:
          action === 'status'
            ? this.testExternalOpen
              ? 'active'
              : 'closed'
            : action === 'open'
              ? 'opened'
              : 'closed',
        Message: 'Mock External TV action.',
      };
    }
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(this.root, 'launcher', 'manage-external-tv.ps1'),
      '-Action',
      action,
      '-Root',
      this.root,
    ];
    if (action === 'open') args.push('-Url', url ?? '');
    if (action === 'open')
      args.push('-Placement', mode ?? 'fullscreen', '-Ratio', String(ratio ?? 65));
    const { stdout } = await execFileAsync(powershell, args, {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    });
    const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!line) throw new Error('External TV launcher returned no result.');
    return JSON.parse(line) as LauncherResult;
  }
  private async runWall(action: 'open' | 'close', mode?: ExternalViewMode, ratio?: SplitRatio) {
    if (this.wall) return this.wall(action, mode, ratio);
    if (process.env.LIVEWALL_TEST_WALL_CONTROL === '1')
      return {
        Ok: true,
        Status: action === 'open' ? 'opened' : 'closed',
        Message: 'Mock Wall action.',
      };
    const powershell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const { stdout } = await execFileAsync(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(this.root, 'launcher', 'manage-wall.ps1'),
        '-Action',
        action,
        '-Root',
        this.root,
        ...(action === 'open' && mode ? ['-Placement', mode, '-Ratio', String(ratio ?? 65)] : []),
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024 },
    );
    return JSON.parse(
      stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '{}',
    ) as LauncherResult;
  }
}
