import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const legacyState = JSON.parse(
  readFileSync(new URL('../src/test/fixtures/legacy-pre-p1.json', import.meta.url), 'utf8'),
) as {
  version: number;
  updatedAt: number;
  layoutMode: string;
  activeAudioTileId: string;
  tiles: Array<{ id: string }>;
};

test('production routes migrate the actual pre-P1 state without a blank page', async ({
  browser,
  request,
}) => {
  const response = await request.put('/api/state', { data: legacyState });
  expect(response.ok()).toBeTruthy();
  const migrated = await response.json();
  expect(migrated.appearance).toEqual({
    backgroundColor: '#020305',
    gap: 4,
    borderVisible: false,
    borderColor: '#303743',
    borderWidth: 1,
    cornerRadius: 0,
  });
  expect(migrated.overlayMode).toBe('hover');
  expect(migrated.globallyStopped).toBe(false);
  expect(migrated.tiles.map((tile: { id: string }) => tile.id)).toEqual(
    legacyState.tiles.map((tile) => tile.id),
  );

  const context = await browser.newContext();
  const admin = await context.newPage();
  const wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);
  await expect(admin.getByRole('heading', { name: 'Video sources' })).toBeVisible();
  await expect(admin.getByLabel('Background')).toHaveValue('#020305');
  await expect(admin.getByLabel('Overlay')).toHaveValue('hover');
  await expect(admin.locator('[data-testid="admin-tile"]')).toHaveCount(2);
  await expect(wall.locator('.player-tile')).toHaveCount(2);
  await expect(wall.locator('.wall')).toHaveCSS('background-color', 'rgb(2, 3, 5)');
  await context.close();
});

test('title overlays honor Off, On hover, and Always visible modes', async ({
  browser,
  request,
}) => {
  await request.put('/api/state', {
    data: {
      version: 0,
      updatedAt: Date.now(),
      layoutMode: 'automatic',
      overlayMode: 'hover',
      tiles: [
        {
          id: 'overlay-one',
          name: 'Overlay One',
          source: { type: 'mock', url: 'https://mock.livewall.local/?label=one' },
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          muted: true,
          volume: 70,
        },
        {
          id: 'overlay-two',
          name: 'Overlay Two',
          source: { type: 'mock', url: 'https://mock.livewall.local/?label=two' },
          x: 4,
          y: 0,
          w: 4,
          h: 4,
          muted: true,
          volume: 70,
        },
      ],
    },
  });
  const context = await browser.newContext();
  const admin = await context.newPage();
  const wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);

  const tiles = wall.locator('.player-tile');
  const labels = wall.locator('.tile-label');
  await expect(tiles).toHaveCount(2);
  await wall.locator('.wall-connection').hover();
  await expect(labels.nth(0)).toHaveCSS('opacity', '0');
  await expect(labels.nth(0)).toHaveCSS('visibility', 'hidden');
  await expect(labels.nth(0)).toHaveCSS('pointer-events', 'none');

  await tiles.nth(0).hover();
  await expect(labels.nth(0)).toHaveCSS('opacity', '1');
  await expect(labels.nth(0)).toHaveCSS('visibility', 'visible');
  await tiles.nth(1).hover();
  await expect(labels.nth(0)).toHaveCSS('opacity', '1');
  await expect(labels.nth(0)).toHaveCSS('opacity', '0', { timeout: 2_500 });
  await expect(labels.nth(0)).toHaveCSS('visibility', 'hidden');

  await tiles.nth(0).focus();
  await expect(labels.nth(0)).toHaveCSS('opacity', '1');

  await wall.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const overlaySelect = admin.locator('.appearance-panel select');
  await expect(overlaySelect).toHaveCount(1);
  await overlaySelect.selectOption('off');
  await expect(labels).toHaveCount(0);

  await overlaySelect.selectOption('always');
  await expect(labels).toHaveCount(2);
  await wall.locator('.wall-connection').hover();
  await expect(labels.nth(0)).toHaveCSS('opacity', '0.72');
  await expect(labels.nth(0)).toHaveCSS('pointer-events', 'none');
  await tiles.nth(0).hover();
  await expect(labels.nth(0)).toHaveCSS('opacity', '1');
  await context.close();
});

test('Save Source dialog and disabled controls remain usable at reduced viewports', async ({
  browser,
  request,
}) => {
  const now = Date.now();
  await request.put('/api/state', {
    data: {
      version: 0,
      updatedAt: now,
      layoutMode: 'automatic',
      tiles: [
        {
          id: 'viewport-tile',
          name: 'Viewport Camera',
          titleMode: 'manual',
          source: { type: 'mock', url: 'https://mock.livewall.local/?label=viewport' },
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          muted: true,
          volume: 70,
          displayOrder: 0,
        },
      ],
      library: {
        version: 1,
        folders: [],
        entries: [
          {
            id: 'saved-youtube',
            originalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            source: {
              type: 'youtube',
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              youtubeId: 'dQw4w9WgXcQ',
            },
            title: 'Saved Video',
            titleMode: 'auto',
            saved: true,
            favorite: false,
            recent: false,
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            useCount: 1,
          },
        ],
      },
    },
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await context.newPage();
  await admin.goto('/admin');

  for (const name of [
    'New folder',
    'Clear Recents',
    'Edit name',
    'Refresh title',
    'Replace Now',
    'Save to Library',
    'Import',
    'Export',
  ])
    await expect(
      admin.getByRole(name === 'Export' ? 'link' : 'button', { name }).first(),
    ).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Queue' }).first()).toBeVisible();

  const disabledStyles = await admin.locator('button:disabled').evaluateAll((buttons) => {
    const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const luminance = (value: string) => {
      const [red, green, blue] = rgb(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    return buttons.map((button) => {
      const style = getComputedStyle(button);
      const lighter = Math.max(luminance(style.color), luminance(style.backgroundColor));
      const darker = Math.min(luminance(style.color), luminance(style.backgroundColor));
      return {
        label: button.textContent?.trim(),
        opacity: Number(style.opacity),
        contrast: (lighter + 0.05) / (darker + 0.05),
        background: style.backgroundColor,
      };
    });
  });
  expect(disabledStyles.length).toBeGreaterThan(0);
  for (const style of disabledStyles) {
    expect(style.opacity, style.label).toBeGreaterThanOrEqual(0.9);
    expect(style.contrast, style.label).toBeGreaterThanOrEqual(4.5);
    expect(style.background, style.label).not.toBe('rgb(255, 255, 255)');
  }

  const trigger = admin.getByRole('button', { name: 'Save to Library' }).first();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1152, height: 720 },
    { width: 960, height: 600 },
  ]) {
    await admin.setViewportSize(viewport);
    await trigger.click();
    const dialog = admin.getByRole('dialog', { name: 'Save Source' });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await expect(admin.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(admin.getByRole('button', { name: 'Save Source', exact: true })).toBeVisible();
    await admin.getByRole('button', { name: 'Cancel' }).click();
  }
  await admin.setViewportSize({ width: 800, height: 400 });
  await trigger.click();
  const scroll = await admin.locator('.dialog-body').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  await expect(admin.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await admin.getByRole('button', { name: 'Cancel' }).click();
  await context.close();
});

test('Admin controls the open Wall and state survives reload', async ({ browser, request }) => {
  await request.put('/api/state', {
    data: { version: 0, updatedAt: Date.now(), layoutMode: 'automatic', tiles: [] },
  });
  const context = await browser.newContext();
  const admin = await context.newPage();
  const wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);

  for (const [name, label] of [
    ['News', 'one'],
    ['Stage', 'two'],
  ]) {
    await admin.locator('header').getByRole('button', { name: 'Add Source' }).click();
    await admin.getByLabel('Tile title').fill(name);
    await admin.getByLabel('Source URL').fill(`https://mock.livewall.local/?label=${label}`);
    await admin.getByRole('button', { name: 'Add source', exact: true }).click();
  }
  await expect(wall.locator('.player-tile')).toHaveCount(2);
  const secondId = await wall.locator('.player-tile').nth(1).getAttribute('data-tile-id');
  const secondInstance = await wall.locator('.mock-player').nth(1).getAttribute('data-instance-id');
  const firstCard = admin.locator('[data-testid="admin-tile"]').first();

  await firstCard.getByLabel(/Queue URL/).fill('https://mock.livewall.local/?label=queued');
  await firstCard.getByRole('button', { name: 'Queue' }).click();

  await firstCard.getByRole('button', { name: 'Replace Now' }).click();
  await admin.getByLabel('Replacement URL').fill('https://mock.livewall.local/?label=replaced');
  await admin.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(wall.locator('.mock-player').first()).toContainText('replaced');
  await expect(wall.locator('.player-tile').nth(1)).toHaveAttribute('data-tile-id', secondId!);
  await expect(wall.locator('.mock-player').nth(1)).toHaveAttribute(
    'data-instance-id',
    secondInstance!,
  );
  await expect(firstCard.locator('.queued-source')).toContainText('queued');
  await firstCard.getByRole('button', { name: 'Play Next' }).click();
  await expect(wall.locator('.mock-player').first()).toContainText('queued');

  await firstCard.getByLabel(/Queue URL/).fill('https://mock.livewall.local/?label=timed');
  await firstCard.getByRole('button', { name: 'Queue' }).click();
  await firstCard.locator('.queue-actions input[type="number"]').fill('1');
  await firstCard.getByRole('button', { name: 'Schedule' }).click();
  await expect(wall.locator('.mock-player').first()).toContainText('timed', { timeout: 5000 });

  const playerInstancesBeforeVolume = await wall
    .locator('.mock-player')
    .evaluateAll((players) => players.map((player) => player.getAttribute('data-instance-id')));
  const volume = admin.getByLabel('Volume for News');
  for (const value of ['10', '30', '50', '70', '90', '42']) await volume.fill(value);
  await expect(wall.locator('.mock-player')).toHaveCount(2);
  await expect
    .poll(() =>
      wall
        .locator('.mock-player')
        .evaluateAll((players) => players.map((player) => player.getAttribute('data-instance-id'))),
    )
    .toEqual(playerInstancesBeforeVolume);

  await admin.getByRole('button', { name: 'Move Stage up' }).click();
  await expect(wall.locator('.tile-label > span').first()).toHaveText('Stage');
  await expect
    .poll(() =>
      wall
        .locator('.mock-player')
        .evaluateAll((players) => players.map((player) => player.getAttribute('data-instance-id'))),
    )
    .toEqual([playerInstancesBeforeVolume[1], playerInstancesBeforeVolume[0]]);
  await admin.getByRole('button', { name: 'Move Stage down' }).click();

  await firstCard.getByRole('button', { name: 'Focus' }).click();
  await expect(wall.locator('.wall')).toHaveClass(/focus-mode/);
  await expect(wall.locator('.player-tile')).toHaveCount(2);
  await expect(wall.locator('.wall-tile-host.focused')).toHaveCount(1);
  await admin.getByRole('button', { name: 'Exit Focus' }).click();

  await admin.getByLabel('Overlay').selectOption('always');
  await expect(wall.locator('.player-tile').first()).toHaveClass(/overlay-always/);
  await admin.getByRole('button', { name: 'Framed' }).click();
  await expect(wall.locator('.auto-wall')).toHaveCSS('gap', '12px');

  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Stop All' }).click();
  await expect(wall.locator('.mock-player')).toHaveCount(0);
  await expect(wall.locator('.player-tile[data-health="stopped"]')).toHaveCount(2);
  await admin.getByRole('button', { name: 'Resume All' }).click();
  await expect(wall.locator('.mock-player')).toHaveCount(2);

  await firstCard.getByRole('button', { name: /Muted/ }).click();
  await admin.getByRole('button', { name: /Freeform/ }).click();
  await expect(wall.locator('.freeform-wall')).toBeVisible();

  admin.once('dialog', (dialog) => dialog.accept());
  await admin
    .locator('[data-testid="admin-tile"]')
    .nth(1)
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(wall.locator('.player-tile')).toHaveCount(1);

  await Promise.all([admin.reload(), wall.reload()]);
  await expect(admin.locator('[data-testid="admin-tile"]')).toHaveCount(1);
  await expect(wall.locator('.mock-player')).toContainText('timed');
  await context.close();
});

test('Source Library workflow and kiosk Wall controls preserve unrelated players', async ({
  browser,
  request,
}) => {
  await request.put('/api/state', {
    data: {
      version: 0,
      updatedAt: Date.now(),
      layoutMode: 'automatic',
      tiles: [
        {
          id: 'stable-base',
          name: 'Stable Base',
          source: { type: 'mock', url: 'https://mock.livewall.local/?label=base' },
          x: 0,
          y: 0,
          w: 4,
          h: 4,
          muted: true,
          volume: 70,
          displayOrder: 0,
        },
      ],
    },
  });
  const context = await browser.newContext();
  const admin = await context.newPage();
  const wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);
  const stableInstance = await wall.locator('.mock-player').getAttribute('data-instance-id');

  await admin.locator('header').getByRole('button', { name: 'Add Source' }).click();
  await admin.getByLabel('Tile title').fill('Library Camera');
  await admin.getByLabel('Source URL').fill('https://mock.livewall.local/?label=library-camera');
  await expect(admin.getByLabel('Save to Library')).not.toBeChecked();
  await admin.getByRole('button', { name: 'Add source', exact: true }).click();
  const row = admin.locator('.library-source-row').filter({ hasText: 'Library Camera' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Recent', { exact: true })).toBeVisible();
  await expect(row.getByText('Saved', { exact: true })).toHaveCount(0);
  await expect(wall.locator('.mock-player').first()).toHaveAttribute(
    'data-instance-id',
    stableInstance!,
  );
  const cameraPlayer = wall.locator('.mock-player').filter({ hasText: 'library-camera' });
  const cameraInstance = await cameraPlayer.getAttribute('data-instance-id');
  const cameraCard = admin
    .locator('[data-testid="admin-tile"]')
    .filter({ hasText: 'Library Camera' });
  const saveTrigger = cameraCard.getByRole('button', { name: 'Save to Library' });

  await saveTrigger.click();
  await admin.getByRole('button', { name: 'Close Save Source dialog' }).click();
  await expect(saveTrigger).toBeFocused();
  await saveTrigger.click();
  await admin.getByRole('button', { name: 'Cancel' }).click();
  await expect(saveTrigger).toBeFocused();
  await saveTrigger.click();
  await admin.keyboard.press('Escape');
  await expect(saveTrigger).toBeFocused();
  await saveTrigger.click();
  await admin.getByTestId('source-dialog-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(saveTrigger).toBeFocused();
  await saveTrigger.click();
  await admin.getByRole('button', { name: 'Save Source', exact: true }).click();
  await expect(admin.locator('.feedback-banner')).toContainText(
    'Saved ‘Library Camera’ to Source Library.',
  );
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  await admin.getByRole('button', { name: 'Dismiss notification' }).click();
  await expect(admin.locator('.feedback-banner')).toHaveCount(0);
  await expect(cameraPlayer).toHaveAttribute('data-instance-id', cameraInstance!);
  await expect(wall.locator('.mock-player').first()).toHaveAttribute(
    'data-instance-id',
    stableInstance!,
  );

  await row.getByRole('button', { name: 'Add Library Camera to favorites' }).click();
  await expect(admin.locator('.feedback-banner')).toContainText(
    'Added ‘Library Camera’ to favorites.',
  );
  await expect(row.getByText('Favorite', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Remove Library Camera from favorites' }).click();
  await expect(admin.locator('.feedback-banner')).toContainText(
    'Removed ‘Library Camera’ from favorites.',
  );
  await expect(row.getByText('Favorite', { exact: true })).toHaveCount(0);
  await expect(cameraPlayer).toHaveAttribute('data-instance-id', cameraInstance!);
  await expect(admin.locator('.feedback-banner')).toHaveCount(0, { timeout: 6_000 });
  admin.once('dialog', (dialog) => dialog.accept('Cameras'));
  await admin.getByRole('button', { name: 'New folder' }).click();
  await row.getByLabel('Folder').selectOption({ label: 'Cameras' });
  await expect(row).toContainText('Cameras');
  await admin.getByLabel('Search').fill('Cameras');
  await expect(admin.locator('.library-source-row')).toHaveCount(1);
  await admin.getByLabel('Search').fill('');

  await row.getByRole('button', { name: 'Add as Tile' }).click();
  await expect(wall.locator('.mock-player')).toHaveCount(3);
  await expect(wall.locator('.mock-player').first()).toHaveAttribute(
    'data-instance-id',
    stableInstance!,
  );
  const unrelatedInstance = await wall
    .locator('.mock-player')
    .nth(2)
    .getAttribute('data-instance-id');

  admin.once('dialog', (dialog) => dialog.accept());
  await row.getByRole('button', { name: 'Replace Tile' }).click();
  await expect(wall.locator('.mock-player').nth(2)).toHaveAttribute(
    'data-instance-id',
    unrelatedInstance!,
  );
  await admin.getByLabel('Target tile').selectOption({ label: 'Library Camera' });
  await row.getByRole('button', { name: 'Queue for Tile' }).click();
  await expect(
    admin.locator('[data-testid="admin-tile"]').filter({ hasText: 'Library Camera' }).first(),
  ).toContainText('library-camera');

  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Clear Recents' }).click();
  await expect(row.getByText('Saved', { exact: true })).toBeVisible();
  await expect(row.getByText('Recent', { exact: true })).toHaveCount(0);

  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Close Wall' }).click();
  await expect(admin.getByRole('button', { name: 'Open Wall' })).toBeVisible();
  expect((await request.get('/api/health')).ok()).toBeTruthy();
  await admin.getByRole('button', { name: 'Open Wall' }).click();
  await expect(admin.getByRole('button', { name: 'Close Wall' })).toBeVisible();

  const kiosk = await context.newPage();
  await kiosk.goto('/wall?launchMode=kiosk');
  await expect(kiosk.getByRole('button', { name: /Fullscreen/ })).toHaveCount(0);
  const normal = await context.newPage();
  await normal.goto('/wall');
  await expect(normal.getByRole('button', { name: 'Enter Fullscreen' })).toBeVisible();

  await admin.reload();
  await admin.getByLabel('Show').selectOption('saved');
  await expect(
    admin.locator('.library-source-row').filter({ hasText: 'Library Camera' }),
  ).toContainText('Cameras');
  await context.close();
});
