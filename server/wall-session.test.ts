// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { parseWallResult, WallSessionService } from './wall-session';

describe('WallSessionService', () => {
  it('uses only its registered fixed action runner and returns close/reopen status', async () => {
    const runner = vi.fn(async (action: 'status' | 'close' | 'open') => ({
      Ok: true,
      Status: action === 'close' ? 'closed' : action === 'open' ? 'opened' : 'open',
      Message: action,
    }));
    const service = new WallSessionService('C:\\LiveWall', runner);
    await expect(service.run('close')).resolves.toMatchObject({ Status: 'closed' });
    await expect(service.run('open')).resolves.toMatchObject({ Status: 'opened' });
    expect(runner).toHaveBeenCalledWith('close');
    expect(runner).toHaveBeenCalledWith('open');
  });

  it('parses only a structured launcher result', () => {
    expect(parseWallResult('progress\n{"Ok":true,"Status":"closed","Message":"done"}\n')).toEqual({
      Ok: true,
      Status: 'closed',
      Message: 'done',
    });
    expect(() => parseWallResult('{"pid":42}')).toThrow(/invalid/i);
  });
});
