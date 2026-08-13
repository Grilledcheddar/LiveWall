import { describe, expect, it } from 'vitest';
import { ExternalTvService } from './external-tv';

describe('External TV coordination', () => {
  it('suspends the Wall, opens only the dedicated session, and restores it', async () => {
    const calls: string[] = [];
    const service = new ExternalTvService(
      'C:/LiveWall',
      async (action) => {
        calls.push(`tv:${action}`);
        return { Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action };
      },
      async (action) => {
        calls.push(`wall:${action}`);
        return { Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action };
      },
    );
    expect((await service.open('https://provider.example/watch')).phase).toBe('external-active');
    expect(calls).toEqual(['wall:close', 'tv:open']);
    expect((await service.open('https://provider.example/again')).phase).toBe('external-active');
    expect(calls).toEqual(['wall:close', 'tv:open']);
    expect((await service.restore()).phase).toBe('wall-active');
    expect(calls).toEqual(['wall:close', 'tv:open', 'tv:close', 'wall:close', 'wall:open']);
  });

  it('rejects unsafe external URLs before a launcher action', async () => {
    const service = new ExternalTvService('C:/LiveWall', async () => ({
      Ok: true,
      Status: 'opened',
      Message: '',
    }));
    await expect(service.open('javascript:alert(1)')).rejects.toThrow(/complete URL|http/i);
  });

  it('rediscovers an existing dedicated External TV session after a server restart', async () => {
    const service = new ExternalTvService('C:/LiveWall', async (action) => ({
      Ok: true,
      Status: action === 'status' ? 'active' : 'closed',
      Message: 'Dedicated profile is active.',
      Url: 'https://provider.example/watch',
    }));
    const status = await service.refresh();
    expect(status).toMatchObject({
      phase: 'external-active',
      url: 'https://provider.example/watch',
    });
  });

  it('keeps an active session during a transient exact-profile status probe failure', async () => {
    let open = false;
    const service = new ExternalTvService(
      'C:/LiveWall',
      async (action) => {
        if (action === 'open') {
          open = true;
          return { Ok: true, Status: 'opened', Message: 'opened' };
        }
        if (action === 'status') throw new Error('Chromium handoff in progress');
        return { Ok: true, Status: 'closed', Message: 'closed' };
      },
      async (action) => ({ Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action }),
    );
    await service.open('https://provider.example/watch');
    expect(open).toBe(true);
    expect((await service.refresh()).phase).toBe('external-active');
  });

  it('safely restores the Wall when the exact external process was already closed', async () => {
    const calls: string[] = [];
    const service = new ExternalTvService(
      'C:/LiveWall',
      async (action) => {
        calls.push(`tv:${action}`);
        return {
          Ok: true,
          Status: action === 'open' ? 'opened' : 'closed',
          Message: action,
        };
      },
      async (action) => {
        calls.push(`wall:${action}`);
        return { Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action };
      },
    );
    await service.open('https://provider.example/watch');
    expect((await service.refresh()).phase).toBe('wall-active');
    expect(calls).toEqual(['wall:close', 'tv:open', 'tv:status', 'tv:close', 'wall:close', 'wall:open']);
  });

  it('opens only the dedicated split Wall and External TV sessions, then restores full Wall', async () => {
    const calls: string[] = [];
    const service = new ExternalTvService(
      'C:/LiveWall',
      async (action, _url, mode, ratio) => {
        calls.push(`tv:${action}:${mode ?? ''}:${ratio ?? ''}`);
        return { Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action };
      },
      async (action, mode, ratio) => {
        calls.push(`wall:${action}:${mode ?? ''}:${ratio ?? ''}`);
        return { Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action };
      },
    );
    await service.open('https://provider.example/watch#preserved', 'external-left', 60);
    expect(calls).toEqual([
      'wall:close::',
      'wall:open:external-left:60',
      'tv:open:external-left:60',
    ]);
    await service.restore();
    expect(calls).toEqual([
      'wall:close::',
      'wall:open:external-left:60',
      'tv:open:external-left:60',
      'tv:close::',
      'wall:close::',
      'wall:open::',
    ]);
  });

  it('restores the Wall when the external close races an already-closed dedicated session', async () => {
    const calls: string[] = [];
    const service = new ExternalTvService(
      'C:/LiveWall',
      async (action) => {
        calls.push(`tv:${action}`);
        if (action === 'close') throw new Error('The dedicated window already exited.');
        return { Ok: true, Status: action === 'status' ? 'closed' : 'opened', Message: action };
      },
      async (action) => {
        calls.push(`wall:${action}`);
        return { Ok: true, Status: 'opened', Message: action };
      },
    );
    await service.open('https://provider.example/watch');
    expect((await service.restore()).phase).toBe('wall-active');
    expect(calls).toEqual(['wall:close', 'tv:open', 'tv:close', 'tv:status', 'wall:close', 'wall:open']);
  });

  it('closes a valid split Wall before reopening the fullscreen kiosk Wall', async () => {
    const calls: string[] = [];
    const service = new ExternalTvService(
      'C:/LiveWall',
      async (action) => ({ Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action }),
      async (action, mode) => {
        calls.push(`${action}:${mode ?? 'fullscreen'}`);
        return { Ok: true, Status: action === 'open' ? 'opened' : 'closed', Message: action };
      },
    );
    await service.open('https://provider.example/watch', 'wall-top', 65);
    await service.restore();
    expect(calls).toEqual([
      'close:fullscreen',
      'open:wall-top',
      'close:fullscreen',
      'open:fullscreen',
    ]);
  });
});
