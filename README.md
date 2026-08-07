# LiveWall

LiveWall is a private, local video wall for Windows. Keep the Wall open on a TV or second monitor and control it from a separate Admin window. Changes appear on the already-open Wall without refreshing it.

## Start on Windows

1. Install the current Node.js LTS release from [nodejs.org](https://nodejs.org/) if it is not already installed.
2. Double-click `start-livewall.bat`.
3. On first run, allow a few minutes for setup. The launcher waits for the production server to become healthy before opening either window.
4. By default, Wall opens in Chrome kiosk mode on `\\.\DISPLAY2` and Admin opens as a normal window on the usable area of `\\.\DISPLAY1`. Press `Alt+F4` in Wall to close kiosk mode.

The launcher uses separate profiles under `data\launcher\browser-profiles`, so it never uses your personal browser profile or extensions. Re-running the launcher reuses a healthy LiveWall server and replaces only these two dedicated LiveWall browser sessions. Other Chrome and Edge windows are left alone.

Kiosk launches use `/wall?launchMode=kiosk`, which hides LiveWall's redundant browser-fullscreen button without changing the other auto-hiding Wall controls. A normal `/wall` window retains the fullscreen button. Admin's **Close Wall** control validates the launcher-owned browser executable, PID, dedicated Wall profile, and Wall URL before closing anything; **Open Wall** restores the dedicated kiosk on Monitor 2. Runtime session details stay under `data\launcher` and are never stored in wall configuration.

Launcher settings are in the local, untracked `launcher\livewall-launcher.json`. On first run, LiveWall creates it from the committed `launcher\livewall-launcher.example.json`; edit the local file if your display identities or preferred port differ:

- `wallDisplay` and `adminDisplay` are stable Windows display identities, not screen-list positions. The launcher logs the identity and DPI-aware bounds of every detected display. If a configured display is absent, it reports that fact and safely uses the primary display.
- `wallMode` is `kiosk` by default.
- `browser` is `chrome`. Chrome is searched in its standard machine-wide and per-user locations; Microsoft Edge is the documented fallback when Chrome is unavailable.
- `port` defaults to `4174`, and `startupTimeoutSeconds` bounds the readiness wait.

Unusual mixed-DPI arrangements are handled using Windows per-monitor DPI awareness and the reported display bounds, including negative coordinates. Windows or browser policies can still constrain final window placement; check `data\launcher\launcher.log` for the exact detected mapping and bounds.

LiveWall only listens on `127.0.0.1`. Other computers on the network cannot connect.

## Basic use

- Use **Add Source** in Admin and paste a complete `http://` or `https://` URL.
- **Replace Now** sits beside Play and Pause. It previews the existing and proposed URL, then changes only that tile after confirmation.
- **Edit title** changes a tile title without touching its player or source.
- Paste a URL under **Up Next** and choose **Queue**. Then choose **Play Next**, or enter a delay in seconds and choose **Schedule**.
- **Cancel** clears both the queued source and timer.
- Select a muted tile’s audio button to make it the active audio source. Every other tile is muted automatically.
- Choose **Freeform** to drag and resize the layout. Switching back to Auto does not erase the freeform arrangement.
- Double-click a tile card to make it the active audio source.
- YouTube sources default to an automatic title from YouTube oEmbed. Typing your own title switches the tile to manual mode; automatic titles can be refreshed explicitly.
- Move the pointer over the Wall to reveal **Enter Fullscreen**. The control hides after a short period; press `Escape` or use **Exit Fullscreen** to leave.
- Use **Play All**, **Pause All**, or **Mute All** for wall-wide transport and audio control. **Stop All** confirms before unloading every player; **Resume All** reconnects at a saved on-demand position or the live edge.
- Drag the handle on an Admin card, or use its **Up** and **Down** buttons, to change automatic display order without changing freeform coordinates.
- Choose **Focus** on an Admin card or the Wall tile control to enlarge one tile while keeping the other players mounted. `Escape` exits focus when the browser is not in fullscreen.
- The status strip reports loading, playback, buffering, retry, stopped, unsupported, and failed states. Recoverable adapter failures retry up to three times; **Retry now** starts a fresh retry cycle for only that source.
- Use **Wall appearance** for overlay visibility, background, gaps, borders, and corner radius. Seamless, Subtle, and Framed presets are included.
- **Source Library** records sources used by Add, Replace, Queue, Play Next, and library actions as automatic **Recents**. Recents are history, not permanent saved sources.
- Choose **Save to Library** on an active tile, a Recent entry, or inside the Add/Edit/Replace workflow to keep a reusable **Saved** source. Saving the same canonical URL updates the existing entry instead of creating a duplicate.
- After a source is saved, use **☆ Add to favorites** to mark it as a Favorite; **★ Favorited** removes that mark when selected again. Saving and favoriting are separate operations, and every entry displays its Recent, Saved, and Favorite labels.
- Recents are deduplicated by canonical source identity and limited to 50. Equivalent YouTube watch, short, live, embed, and `youtu.be` URLs for one video share one entry. Clearing Recents never removes saved sources, favorites, or active tiles.
- Library exports are versioned JSON. Import shows a merge preview, rejects unsafe URLs, creates a state backup, merges duplicates by canonical identity, and never overwrites active tiles.

Volume changes are sent directly to the selected player while the slider moves and saved after a short debounce. They do not reload the Wall or recreate players.

The Wall starts remote players muted because Chrome and Edge generally block autoplay with sound. If a provider still asks for interaction, click its player once.

## Supported sources

| Source                                                   | Playback                           | Remote controls                                            |
| -------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| YouTube videos, Live, Shorts, `youtu.be`, and embed URLs | Official YouTube IFrame Player API | Play, pause, seek, mute, volume                            |
| Direct HLS / `.m3u8`                                     | hls.js or browser-native HLS       | Play, pause, seek when the stream permits it, mute, volume |
| Generic websites                                         | Best-effort iframe                 | Not available                                              |

Generic sites may refuse to appear because of CSP, `X-Frame-Options`, DRM, login requirements, cookies, or provider policy. LiveWall does not bypass these controls. Pluto TV and many commercial streaming services are expected to block or restrict embedding. Use **Open externally** when a provider does not allow embedding.

Hulu, Paramount+, DIRECTV, and YouTube TV cannot be embedded as normal LiveWall tiles because their DRM, authentication, and provider policies require supported first-party playback. Open those services externally instead.

## Saved configuration, backup, and reset

The authoritative configuration is stored in `data\wall-state.json`. It contains source URLs, queues, absolute timer timestamps, layout coordinates, display order, volume, mute state, title mode, active audio selection, stop/resume state, focus selection, overlays, appearance, and the Source Library. Runtime health and dedicated-browser session records are intentionally separate and transient.

When an older state file is opened, LiveWall adds safe defaults for newer fields while preserving existing URLs, names, queues, timers, layouts, volume, mute, and audio selection. A failed migration leaves the original file untouched and prevents startup instead of replacing the wall with an empty state. Backups created before upgrades are kept under `data\backups`.

- Back up: stop LiveWall and copy `data\wall-state.json` somewhere safe.
- Restore: stop LiveWall and replace the file with the backup.
- Reset: stop LiveWall and delete `data\wall-state.json`. A clean file is created next time.

No analytics are collected. Configuration, Source Library entries, backups, logs, and dedicated browser profiles stay in the local ignored `data` directory and are not part of the source repository. Video URLs are contacted directly by the browser only when needed for playback.

## Development

```powershell
npm install
npm run dev
```

Development URLs:

- Admin: `http://127.0.0.1:5173/admin`
- Wall: `http://127.0.0.1:5173/wall`

Quality commands:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm start
```

Production/local URLs use port `4174`.

## YouTube Error 153 troubleshooting

LiveWall serves the player from a real localhost HTTP page and uses a strict-origin referrer policy. This meets YouTube’s referrer requirement. If Error 153 appears:

1. Confirm the address begins with `http://127.0.0.1:4174/`, not `file://`.
2. Temporarily disable extensions that strip the `Referer` header or block YouTube scripts.
3. Check that browser privacy software permits requests to `youtube.com` and `googlevideo.com`.
4. Try a known public, embeddable video. Owners can disable embedding for individual videos.
5. Restart LiveWall and reload the Wall.

Manual validation: add a known public embeddable YouTube URL, confirm it begins playing muted on Wall, then verify play, pause, seek, active audio, and volume from Admin. Provider-dependent playback is intentionally not used in automated tests.

## Troubleshooting

- **Wall says Reconnecting:** make sure the minimized “LiveWall Server” command window is still running, then wait a few seconds.
- **Blank or blocked generic page:** use **Open externally**. Cross-origin browser rules prevent reliable automatic detection for every provider.
- **HLS source fails:** confirm the URL points directly to an `.m3u8` playlist and allows browser cross-origin requests.
- **Autoplay is paused:** click the player once. Browser autoplay policy can vary with local settings.
- **Port 4174 is busy:** close the older LiveWall server process before launching again.

## Architecture

The React/TypeScript Vite client has separate `/admin` and `/wall` routes. A small Express server is the authoritative state owner, persists an atomic JSON file, and resolves YouTube oEmbed titles without an API key. WebSocket messages provide prompt synchronization and `BroadcastChannel` provides an additional same-origin fast path. Every Wall connection receives a complete state snapshot, so reopening or reconnecting catches up automatically. Scheduled replacements use persisted absolute timestamps and are reconciled by the server after a restart. Player adapters isolate YouTube, HLS, generic iframe, and deterministic test behavior; stable tile IDs and source-only lifecycle boundaries prevent metadata and volume changes from remounting players.
