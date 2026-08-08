import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  LayoutTemplateFile,
  PlaybackProgressFile,
  PlayerCommand,
  PlayerHealth,
  ServerMessage,
  WallPresetFile,
} from '../src/lib/types.js';
import { StateStore } from './state-store.js';
import { fetchYouTubeTitle } from './youtube-title.js';
import { exportLibrary } from '../src/lib/library.js';
import { WallSessionService } from './wall-session.js';
import { ExternalTvService } from './external-tv.js';
import { AtomicJsonStore } from './p3-store.js';
import { normalizePlaybackProgress, playbackKey } from '../src/lib/playback.js';
import { normalizeLayoutTemplates } from '../src/lib/layouts.js';
import { normalizeWallPresets } from '../src/lib/walls.js';
import { detectSource } from '../src/lib/sources.js';

const root = process.cwd();
const port = Number(process.env.PORT || 4174);
const host = '127.0.0.1';
const store = new StateStore(path.join(root, 'data'));
const dataDirectory = path.join(root, 'data');
const progressStore = new AtomicJsonStore<PlaybackProgressFile>(
  dataDirectory,
  'playback-progress.json',
  () => normalizePlaybackProgress(undefined),
  normalizePlaybackProgress,
);
const templatesStore = new AtomicJsonStore<LayoutTemplateFile>(
  dataDirectory,
  'layout-templates.json',
  () => normalizeLayoutTemplates(undefined),
  normalizeLayoutTemplates,
);
const presetsStore = new AtomicJsonStore<WallPresetFile>(
  dataDirectory,
  'wall-presets.json',
  () => normalizeWallPresets(undefined),
  normalizeWallPresets,
);
const wallSession = new WallSessionService(root);
const externalTv = new ExternalTvService(root);
let stateLoadError = '';
try {
  await store.load();
} catch (error) {
  stateLoadError =
    'Saved wall data could not be migrated. The original file was preserved; restore a backup or repair the state file, then restart LiveWall.';
  console.error(stateLoadError, error);
}
let p3LoadError = '';
for (const [label, p3Store] of [
  ['playback progress', progressStore],
  ['layout templates', templatesStore],
  ['wall presets', presetsStore],
] as const) {
  try {
    await p3Store.load();
  } catch (error) {
    p3LoadError = `${label} could not be migrated. Its original file was preserved.`;
    console.error(p3LoadError, error);
  }
}

const app = express();
app.use(cors({ origin: [`http://${host}:5173`, `http://${host}:${port}`] }));
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) =>
  res.json({
    ok: !stateLoadError,
    stateError: stateLoadError || undefined,
    p3Error: p3LoadError || undefined,
  }),
);
app.get('/api/state', (_req, res) =>
  stateLoadError ? res.status(503).json({ message: stateLoadError }) : res.json(store.get()),
);
app.get('/api/youtube-title', async (req, res) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    res.json({ title: await fetchYouTubeTitle(url) });
  } catch (error) {
    res.status(422).json({
      message: error instanceof Error ? error.message : 'The YouTube title could not be loaded.',
    });
  }
});

app.get('/api/playback-progress', (_req, res) => res.json(progressStore.get()));
app.put('/api/playback-progress', async (req, res) => {
  try {
    const source = detectSource(String(req.body?.sourceUrl ?? ''));
    const key = playbackKey(source);
    const position = Number(req.body?.position);
    const duration = Number(req.body?.duration);
    const playlistIndex = Number(req.body?.playlistIndex);
    if (!Number.isFinite(position) || position < 0)
      return res.status(400).json({ message: 'Playback progress was not valid.' });
    const next = await progressStore.update((current) => ({
      ...current,
      entries: [
        ...current.entries.filter((entry) => entry.key !== key),
        {
          key,
          position,
          duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
          playlistIndex:
            Number.isInteger(playlistIndex) && playlistIndex >= 0 ? playlistIndex : undefined,
          updatedAt: Date.now(),
        },
      ],
    }));
    return res.json(next);
  } catch {
    return res.status(400).json({ message: 'Playback progress was not valid.' });
  }
});
app.delete('/api/playback-progress', async (req, res) => {
  try {
    const key = playbackKey(detectSource(String(req.query.sourceUrl ?? '')));
    return res.json(
      await progressStore.update((current) => ({
        ...current,
        entries: current.entries.filter((entry) => entry.key !== key),
      })),
    );
  } catch {
    return res.status(400).json({ message: 'Playback progress key was not valid.' });
  }
});

app.get('/api/layout-templates', (_req, res) => res.json(templatesStore.get()));
app.put('/api/layout-templates', async (req, res) => {
  try {
    return res.json(await templatesStore.replace(req.body));
  } catch {
    return res.status(400).json({ message: 'Layout templates were not valid.' });
  }
});

app.get('/api/wall-presets', (_req, res) => res.json(presetsStore.get()));
app.put('/api/wall-presets', async (req, res) => {
  try {
    return res.json(await presetsStore.replace(req.body));
  } catch {
    return res.status(400).json({ message: 'Wall presets were not valid.' });
  }
});

app.get('/api/p3/export', (_req, res) => {
  res.setHeader('content-disposition', `attachment; filename="livewall-p3-${Date.now()}.json"`);
  res.json({
    format: 'livewall-p3',
    version: 1,
    exportedAt: Date.now(),
    templates: templatesStore.get(),
    presets: presetsStore.get(),
  });
});

const previewP3Import = (value: unknown) => {
  if (!value || typeof value !== 'object' || (value as any).format !== 'livewall-p3')
    throw new Error('This is not a LiveWall P3 export.');
  const templates = normalizeLayoutTemplates((value as any).templates);
  const presets = normalizeWallPresets((value as any).presets);
  return {
    templates,
    presets,
    templateCount: templates.templates.length,
    presetCount: presets.presets.length,
  };
};
app.post('/api/p3/import/preview', (req, res) => {
  try {
    res.json(previewP3Import(req.body));
  } catch (error) {
    res
      .status(400)
      .json({ message: error instanceof Error ? error.message : 'Import is invalid.' });
  }
});
app.post('/api/p3/import', async (req, res) => {
  try {
    const preview = previewP3Import(req.body);
    const backups = await Promise.all([
      templatesStore.backup('layout-templates-import'),
      presetsStore.backup('wall-presets-import'),
    ]);
    const templates = await templatesStore.replace(preview.templates);
    const presets = await presetsStore.replace(preview.presets);
    res.json({ templates, presets, backups });
  } catch (error) {
    res
      .status(400)
      .json({ message: error instanceof Error ? error.message : 'Import is invalid.' });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const broadcast = (message: ServerMessage) => {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => client.readyState === WebSocket.OPEN && client.send(payload));
};
const latestHealthByTile = new Map<string, PlayerHealth>();

app.put('/api/state', async (req, res) => {
  if (stateLoadError) return res.status(503).json({ message: stateLoadError });
  try {
    const state = await store.replace(req.body);
    broadcast({ type: 'state', state });
    return res.json(state);
  } catch {
    return res.status(400).json({ message: 'The wall configuration was not valid.' });
  }
});

app.put('/api/library', async (req, res) => {
  if (stateLoadError) return res.status(503).json({ message: stateLoadError });
  try {
    const state = await store.replaceLibrary(req.body?.library, req.body?.expectedVersion);
    broadcast({ type: 'state', state });
    return res.json(state);
  } catch (error) {
    if (error instanceof Error && error.message === 'SOURCE_LIBRARY_CONFLICT') {
      return res.status(409).json({
        message:
          'The Source Library changed in another window. Review the latest version and retry.',
        state: store.get(),
      });
    }
    return res.status(400).json({ message: 'The Source Library was not valid.' });
  }
});

app.get('/api/library/export', (_req, res) => {
  if (stateLoadError) return res.status(503).json({ message: stateLoadError });
  res.setHeader(
    'content-disposition',
    `attachment; filename="livewall-source-library-${Date.now()}.json"`,
  );
  res.json(exportLibrary(store.get().library));
});

app.post('/api/library/import/preview', (req, res) => {
  if (stateLoadError) return res.status(503).json({ message: stateLoadError });
  try {
    return res.json(store.previewLibraryImport(req.body));
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'The Source Library import was not valid.',
    });
  }
});

app.post('/api/library/import', async (req, res) => {
  if (stateLoadError) return res.status(503).json({ message: stateLoadError });
  try {
    const result = await store.importLibrary(req.body);
    broadcast({ type: 'state', state: result.state });
    return res.json(result);
  } catch (error) {
    return res.status(400).json({
      message: error instanceof Error ? error.message : 'The Source Library import was not valid.',
    });
  }
});

app.get('/api/wall-session', async (_req, res) => {
  try {
    res.json(await wallSession.run('status'));
  } catch {
    res.status(500).json({
      Ok: false,
      Status: 'error',
      Message: 'The dedicated Wall status could not be checked.',
    });
  }
});
app.get('/api/external-tv', async (_req, res) => {
  try {
    res.json(await externalTv.refresh());
  } catch {
    res.status(503).json({ phase: 'failed', message: 'External TV status is unavailable.' });
  }
});
app.post('/api/external-tv/open', async (req, res) => {
  try {
    const result = await externalTv.open(String(req.body?.url ?? ''));
    res.status(result.phase === 'failed' ? 422 : 200).json(result);
  } catch (error) {
    res.status(400).json({
      phase: 'failed',
      message: error instanceof Error ? error.message : 'External TV URL was invalid.',
    });
  }
});
app.post('/api/external-tv/return', async (_req, res) => {
  try {
    res.json(await externalTv.restore());
  } catch {
    res.status(503).json({ phase: 'failed', message: 'External TV could not be restored.' });
  }
});

for (const action of ['close', 'open'] as const) {
  app.post(`/api/wall-session/${action}`, async (_req, res) => {
    try {
      const result = await wallSession.run(action);
      res.status(result.Ok ? 200 : 409).json(result);
    } catch {
      res.status(500).json({
        Ok: false,
        Status: 'error',
        Message: `The dedicated Wall could not be ${action === 'close' ? 'closed' : 'opened'}.`,
      });
    }
  });
}

app.post('/api/command', (req, res) => {
  const command = req.body as PlayerCommand;
  if (!command?.id || !command?.tileId || !command?.command) {
    return res.status(400).json({ message: 'The player command was not valid.' });
  }
  broadcast({ type: 'command', command });
  res.status(202).json({ ok: true });
});

app.post('/api/player-health', (req, res) => {
  const health = req.body as PlayerHealth;
  if (!health?.tileId || !health?.sourceUrl || !health?.status) {
    return res.status(400).json({ message: 'The player health event was not valid.' });
  }
  latestHealthByTile.set(health.tileId, health);
  broadcast({ type: 'health', health });
  res.status(202).json({ ok: true });
});

app.get('/api/player-health', (_req, res) => {
  const activeTileIds = new Set(store.get().tiles.map((tile) => tile.id));
  res.json([...latestHealthByTile.values()].filter((health) => activeTileIds.has(health.tileId)));
});

app.post('/api/resume-position', async (req, res) => {
  const { tileId, sourceUrl, position } = req.body as {
    tileId?: string;
    sourceUrl?: string;
    position?: number;
  };
  if (!tileId || !sourceUrl || typeof position !== 'number') {
    return res.status(400).json({ message: 'The resume position was not valid.' });
  }
  const state = await store.saveResumePosition(tileId, sourceUrl, position);
  broadcast({ type: 'state', state });
  res.json(state);
});

wss.on('connection', (socket) => {
  const message: ServerMessage = stateLoadError
    ? { type: 'error', message: stateLoadError }
    : { type: 'hello', state: store.get() };
  socket.send(JSON.stringify(message));
  if (!stateLoadError) {
    const activeTileIds = new Set(store.get().tiles.map((tile) => tile.id));
    latestHealthByTile.forEach((health) => {
      if (activeTileIds.has(health.tileId))
        socket.send(JSON.stringify({ type: 'health', health } satisfies ServerMessage));
    });
  }
});

const dist = path.join(root, 'dist');
app.use(express.static(dist));
app.use((_req, res) => res.sendFile('index.html', { root: dist }));

const reconciliationTimer = setInterval(async () => {
  if (!stateLoadError && (await store.reconcile()))
    broadcast({ type: 'state', state: store.get() });
}, 500);

server.listen(port, host, () => {
  console.log(`LiveWall is running at http://${host}:${port}`);
  console.log(`Admin: http://${host}:${port}/admin`);
  console.log(`Wall:  http://${host}:${port}/wall`);
});

function shutdown() {
  clearInterval(reconciliationTimer);
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
