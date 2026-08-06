import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { PlayerCommand, PlayerHealth, ServerMessage } from '../src/lib/types.js';
import { StateStore } from './state-store.js';
import { fetchYouTubeTitle } from './youtube-title.js';
import { exportLibrary } from '../src/lib/library.js';
import { WallSessionService } from './wall-session.js';

const root = process.cwd();
const port = Number(process.env.PORT || 4174);
const host = '127.0.0.1';
const store = new StateStore(path.join(root, 'data'));
const wallSession = new WallSessionService(root);
let stateLoadError = '';
try {
  await store.load();
} catch (error) {
  stateLoadError =
    'Saved wall data could not be migrated. The original file was preserved; restore a backup or repair the state file, then restart LiveWall.';
  console.error(stateLoadError, error);
}

const app = express();
app.use(cors({ origin: [`http://${host}:5173`, `http://${host}:${port}`] }));
app.use(express.json({ limit: '256kb' }));
app.get('/api/health', (_req, res) =>
  res.json({ ok: !stateLoadError, stateError: stateLoadError || undefined }),
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

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const broadcast = (message: ServerMessage) => {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => client.readyState === WebSocket.OPEN && client.send(payload));
};

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
  broadcast({ type: 'health', health });
  res.status(202).json({ ok: true });
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
});

const dist = path.join(root, 'dist');
app.use(express.static(dist));
app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')));

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
