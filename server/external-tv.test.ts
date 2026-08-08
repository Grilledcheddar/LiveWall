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
    expect(calls).toEqual(['wall:close', 'tv:open', 'tv:close', 'wall:open']);
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
});
