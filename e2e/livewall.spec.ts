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

test('production Source Library controls have distinct enabled, hover, focus, and disabled styles', async ({
  browser,
  request,
}, testInfo) => {
  const now = Date.now();
  await request.put('/api/state', {
    data: {
      version: 0,
      updatedAt: now,
      layoutMode: 'automatic',
      tiles: [
        {
          id: 'style-tile',
          name: 'Style Camera',
          titleMode: 'manual',
          source: { type: 'mock', url: 'https://mock.livewall.local/?label=style-camera' },
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
        folders: [
          {
            id: 'style-folder',
            name: 'Cameras',
            displayOrder: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
        entries: [
          {
            id: 'style-saved',
            originalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            source: {
              type: 'youtube',
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              youtubeId: 'dQw4w9WgXcQ',
            },
            title: 'Saved Camera',
            titleMode: 'auto',
            saved: true,
            favorite: false,
            recent: true,
            folderId: 'style-folder',
            createdAt: now,
            updatedAt: now,
            lastUsedAt: now,
            useCount: 1,
          },
          {
            id: 'style-recent',
            originalUrl: 'https://example.com/live-camera',
            canonicalUrl: 'https://example.com/live-camera',
            source: { type: 'website', url: 'https://example.com/live-camera' },
            title: 'Recent Camera',
            titleMode: 'manual',
            saved: false,
            favorite: false,
            recent: true,
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
  const library = admin.locator('.source-library');
  const newFolder = library.getByRole('button', { name: 'New folder' });
  const clearRecents = library.getByRole('button', { name: 'Clear Recents' });
  const folderSelector = library
    .locator('.library-source-row')
    .filter({ hasText: 'Saved Camera' })
    .getByLabel('Folder');
  const disabledSave = library.getByRole('button', { name: 'Saved to Library' });

  for (const control of [newFolder, clearRecents, folderSelector])
    await expect(control).toBeEnabled();
  await expect(disabledSave).toBeDisabled();

  const readStyle = async (control: typeof newFolder) =>
    control.evaluate((element) => {
      const style = getComputedStyle(element);
      const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [red, green, blue] = channels(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const contrast = (first: string, second: string) => {
        const lighter = Math.max(luminance(first), luminance(second));
        const darker = Math.min(luminance(first), luminance(second));
        return (lighter + 0.05) / (darker + 0.05);
      };
      return {
        background: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        border: style.borderColor,
        color: style.color,
        cursor: style.cursor,
        opacity: style.opacity,
        outline: style.outlineStyle,
        outlineColor: style.outlineColor,
        textContrast: contrast(style.color, style.backgroundColor),
        borderContrast: contrast(style.borderColor, style.backgroundColor),
      };
    });

  const enabled = await readStyle(newFolder);
  const enabledSelect = await readStyle(folderSelector);
  const disabled = await readStyle(disabledSave);
  expect(enabled.textContrast).toBeGreaterThanOrEqual(4.5);
  expect(enabled.borderContrast).toBeGreaterThanOrEqual(3);
  expect(enabled.cursor).toBe('pointer');
  expect(enabled.opacity).toBe('1');
  expect(enabled.background).not.toBe('rgb(240, 240, 240)');
  expect(enabledSelect.textContrast).toBeGreaterThanOrEqual(4.5);
  expect(enabledSelect.backgroundImage).not.toBe('none');
  expect(enabledSelect.cursor).toBe('pointer');
  expect(enabledSelect.background).not.toBe(disabled.background);
  expect(enabledSelect.color).not.toBe(disabled.color);
  expect(enabledSelect.border).not.toBe(disabled.border);

  const filterSelects = library.locator('.library-controls select');
  await expect(filterSelects).toHaveCount(5);
  for (const [index, label] of ['Show', 'Type', 'Folder', 'Sort', 'Target tile'].entries()) {
    const select = filterSelects.nth(index);
    await expect(select).toBeEnabled();
    const selectStyle = await readStyle(select);
    expect(selectStyle.textContrast, label).toBeGreaterThanOrEqual(4.5);
    expect(selectStyle.backgroundImage, label).not.toBe('none');
  }
  const optionStyle = await folderSelector
    .locator('option')
    .first()
    .evaluate((option) => {
      const style = getComputedStyle(option);
      return { color: style.color, background: style.backgroundColor };
    });
  expect(optionStyle.color).toBe('rgb(241, 245, 250)');
  expect(optionStyle.background).toBe('rgb(17, 24, 32)');

  const base = await readStyle(newFolder);
  await newFolder.hover();
  const hovered = await readStyle(newFolder);
  expect(hovered.background).not.toBe(base.background);
  expect(hovered.border).not.toBe(base.border);
  await newFolder.focus();
  const focused = await readStyle(newFolder);
  expect(focused.outline).not.toBe('none');
  expect(focused.outlineColor).toBe('rgb(200, 255, 61)');

  for (const name of [
    'Edit name',
    'Refresh title',
    'Add as Tile',
    'Replace Tile',
    'Queue for Tile',
    'Copy URL',
    'Import',
    'Export',
    'Save to Library',
  ]) {
    const role = name === 'Export' ? 'link' : 'button';
    const control = library.getByRole(role, { name }).first();
    await expect(control, name).toBeEnabled();
    expect((await readStyle(control)).textContrast, name).toBeGreaterThanOrEqual(4.5);
  }
  const openExternally = library.getByRole('link', { name: 'Open Externally' }).first();
  await expect(openExternally).toBeEnabled();
  expect((await readStyle(openExternally)).textContrast).toBeGreaterThanOrEqual(4.5);

  let folderPrompt = '';
  admin.once('dialog', async (dialog) => {
    folderPrompt = dialog.message();
    await dialog.dismiss();
  });
  await newFolder.click();
  expect(folderPrompt).toContain('Folder name');

  const tileSave = admin
    .locator('[data-testid="admin-tile"]')
    .getByRole('button', { name: 'Save to Library' });
  await tileSave.click();
  const cancel = admin.getByRole('button', { name: 'Cancel' });
  const save = admin.getByRole('button', { name: 'Save Source', exact: true });
  await expect(cancel).toBeEnabled();
  await expect(save).toBeEnabled();
  expect((await readStyle(cancel)).textContrast).toBeGreaterThanOrEqual(4.5);
  expect((await readStyle(save)).textContrast).toBeGreaterThanOrEqual(4.5);
  await cancel.click();

  const productionStylesheet = await admin.evaluate(() =>
    [...document.styleSheets].some(
      (sheet) =>
        sheet.href?.includes('/assets/') &&
        [...sheet.cssRules].some((rule) => rule.cssText.includes('.source-library select')),
    ),
  );
  expect(productionStylesheet).toBe(true);
  await library.screenshot({ path: testInfo.outputPath('source-library-controls.png') });
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
  await admin.getByLabel('Search', { exact: true }).fill('Cameras');
  await expect(admin.locator('.library-source-row')).toHaveCount(1);
  await admin.getByLabel('Search', { exact: true }).fill('');

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

test('P3 layout previews, custom templates, and named walls preserve live players', async ({
  browser,
  request,
}) => {
  const tiles = ['alpha', 'bravo', 'charlie'].map((label, displayOrder) => ({
    id: `p3-${label}`,
    name: label.toUpperCase(),
    titleMode: 'manual',
    source: { type: 'mock', url: `https://mock.livewall.local/?label=${label}` },
    playback: { behavior: 'resume' },
    x: (displayOrder % 2) * 6,
    y: Math.floor(displayOrder / 2) * 6,
    w: 6,
    h: 6,
    muted: true,
    volume: 40 + displayOrder,
    displayOrder,
  }));
  await request.put('/api/state', {
    data: { version: 0, updatedAt: Date.now(), layoutMode: 'automatic', tiles },
  });
  await request.put('/api/layout-templates', { data: { templates: [] } });
  await request.put('/api/wall-presets', { data: { presets: [] } });
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  const admin = await context.newPage();
  const wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);
  const p3ControlStyles = await admin.locator('.p3-workspace').evaluate((workspace) => {
    const luminance = (value: string) => {
      const channels = (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const [red, green, blue] = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    return [...workspace.querySelectorAll('button, select, input')].map((control) => {
      const style = getComputedStyle(control);
      const lighter = Math.max(luminance(style.color), luminance(style.backgroundColor));
      const darker = Math.min(luminance(style.color), luminance(style.backgroundColor));
      return {
        label: control.textContent?.trim() || control.getAttribute('aria-label'),
        background: style.backgroundColor,
        border: style.borderColor,
        cursor: style.cursor,
        contrast: (lighter + 0.05) / (darker + 0.05),
      };
    });
  });
  for (const control of p3ControlStyles) {
    expect(control.background, control.label).not.toBe('rgb(240, 240, 240)');
    expect(control.background, control.label).not.toBe('rgb(255, 255, 255)');
    expect(control.contrast, control.label).toBeGreaterThanOrEqual(4.5);
    expect(control.border, control.label).not.toBe('rgb(0, 0, 0)');
  }
  const instances = await wall
    .locator('.mock-player')
    .evaluateAll((players) => players.map((player) => player.getAttribute('data-instance-id')));

  await admin.getByRole('tab', { name: 'Layouts' }).click();
  const customTrigger = admin.getByRole('button', { name: 'New Custom Layout' });
  await customTrigger.click();
  const builderBounds = await admin
    .getByRole('dialog', { name: 'New layout template' })
    .boundingBox();
  expect(builderBounds).not.toBeNull();
  expect(builderBounds!.x).toBeGreaterThanOrEqual(0);
  expect(builderBounds!.y).toBeGreaterThanOrEqual(0);
  expect(builderBounds!.x + builderBounds!.width).toBeLessThanOrEqual(960);
  expect(builderBounds!.y + builderBounds!.height).toBeLessThanOrEqual(600);
  await admin.getByLabel('Unique template name').fill('Two top and wide bottom');
  await admin.getByRole('button', { name: 'Preview', exact: true }).last().click();
  await expect(admin.getByText('3 usable slots')).toBeVisible();
  await admin.getByRole('button', { name: 'Save Template' }).click();
  const customCard = admin.locator('.layout-card').filter({ hasText: 'Two top and wide bottom' });
  await expect(customCard).toBeVisible();
  await customCard.getByRole('button', { name: 'Preview' }).click();
  await admin.getByRole('button', { name: 'Apply Layout' }).click();
  await expect
    .poll(() =>
      wall
        .locator('.mock-player')
        .evaluateAll((players) => players.map((player) => player.getAttribute('data-instance-id'))),
    )
    .toEqual(instances);
  const laidOut = await request.get('/api/state').then((response) => response.json());
  expect(laidOut.layoutMode).toBe('template');
  expect(laidOut.tiles.map((tile: { id: string }) => tile.id)).toEqual(
    tiles.map((tile) => tile.id),
  );

  await admin.getByRole('tab', { name: 'Named Walls' }).click();
  admin.once('dialog', (dialog) => dialog.accept('Morning desk'));
  await admin.getByRole('button', { name: 'Save Current Wall' }).click();
  const presetCard = admin.locator('.preset-card').filter({ hasText: 'Morning desk' });
  await expect(presetCard).toBeVisible();
  const savedBefore = await request.get('/api/wall-presets').then((response) => response.json());
  const savedColor = savedBefore.presets[0].state.appearance.backgroundColor;
  await admin.getByLabel('Background').fill('#123456');
  await expect(admin.locator('.workspace-state')).toContainText('Modified');
  const unchanged = await request.get('/api/wall-presets').then((response) => response.json());
  expect(unchanged.presets[0].state.appearance.backgroundColor).toBe(savedColor);
  await admin.getByRole('button', { name: 'Update Preset' }).click();
  await expect
    .poll(
      async () =>
        (await request.get('/api/wall-presets').then((response) => response.json())).presets[0]
          .state.appearance.backgroundColor,
    )
    .toBe('#123456');

  await admin.getByLabel('Background').fill('#654321');
  const beforeLayoutOnly = await request.get('/api/state').then((response) => response.json());
  admin.once('dialog', (dialog) => dialog.accept());
  await presetCard.getByRole('button', { name: 'Preview' }).click();
  await expect(admin.getByRole('dialog', { name: /Preview wall: Morning desk/ })).toBeVisible();
  await admin.getByRole('button', { name: 'Apply Layout Only' }).click();
  const afterLayoutOnly = await request.get('/api/state').then((response) => response.json());
  for (const field of [
    'source',
    'name',
    'queuedSource',
    'scheduledAt',
    'volume',
    'muted',
    'playback',
  ])
    expect(afterLayoutOnly.tiles.map((tile: Record<string, unknown>) => tile[field])).toEqual(
      beforeLayoutOnly.tiles.map((tile: Record<string, unknown>) => tile[field]),
    );
  expect(afterLayoutOnly.activeAudioTileId).toBe(beforeLayoutOnly.activeAudioTileId);
  expect(afterLayoutOnly.appearance.backgroundColor).toBe('#654321');
  await expect
    .poll(() =>
      wall
        .locator('.mock-player')
        .evaluateAll((players) => players.map((player) => player.getAttribute('data-instance-id'))),
    )
    .toEqual(instances);
  await context.close();
});

test('P3 VOD progress survives pause, progress writes, Wall reopen, and Stop/Resume', async ({
  browser,
  request,
}) => {
  const sourceUrl = 'https://mock.livewall.local/?label=restored&duration=300';
  await request.delete(`/api/playback-progress?sourceUrl=${encodeURIComponent(sourceUrl)}`);
  const savedPosition = async () =>
    (await request.get('/api/playback-progress').then((response) => response.json())).entries.find(
      (entry: { key: string }) => entry.key === sourceUrl,
    )?.position;
  await request.put('/api/state', {
    data: {
      version: 0,
      updatedAt: Date.now(),
      layoutMode: 'automatic',
      tiles: [
        {
          id: 'restored-vod',
          name: 'Restored VOD',
          titleMode: 'manual',
          source: { type: 'mock', url: sourceUrl },
          playback: { behavior: 'specific', specificTime: 85 },
          x: 0,
          y: 0,
          w: 12,
          h: 12,
          muted: true,
          volume: 55,
          displayOrder: 0,
        },
      ],
    },
  });
  const context = await browser.newContext();
  const admin = await context.newPage();
  let wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);
  const instance = await wall.locator('.mock-player').getAttribute('data-instance-id');
  await expect(wall.locator('.mock-player')).toHaveAttribute('data-position', '85');
  await admin.locator('[data-testid="admin-tile"]').getByRole('button', { name: 'Pause' }).click();
  await expect.poll(savedPosition).toBe(85);
  await expect(wall.locator('.mock-player')).toHaveAttribute('data-instance-id', instance!);

  await wall.close();
  wall = await context.newPage();
  await wall.goto('/wall');
  await expect(wall.locator('.mock-player')).toBeVisible();
  admin.once('dialog', (dialog) => dialog.accept());
  await admin.getByRole('button', { name: 'Stop All' }).click();
  await expect(wall.locator('.mock-player')).toHaveCount(0);
  await expect.poll(savedPosition).toBe(85);
  await admin.getByRole('button', { name: 'Resume All' }).click();
  await expect(wall.locator('.mock-player')).toBeVisible();
  await context.close();
});

test('P3 playback repair preserves ordered Admin control and active audio before a Wall click', async ({
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
          id: 'audio-first',
          name: 'Audio First',
          source: {
            type: 'mock',
            url: 'https://mock.livewall.local/?label=audio-first&rejectPlay=1&position=17',
          },
          x: 0,
          y: 0,
          w: 6,
          h: 6,
          muted: true,
          volume: 61,
          displayOrder: 0,
        },
        {
          id: 'audio-second',
          name: 'Audio Second',
          source: {
            type: 'mock',
            url: 'https://mock.livewall.local/?label=audio-second&position=29',
          },
          x: 6,
          y: 0,
          w: 6,
          h: 6,
          muted: true,
          volume: 37,
          displayOrder: 1,
        },
      ],
    },
  });
  const context = await browser.newContext();
  const admin = await context.newPage();
  const wall = await context.newPage();
  await Promise.all([admin.goto('/admin'), wall.goto('/wall')]);
  const players = wall.locator('.mock-player');
  await expect(players).toHaveCount(2);
  await expect
    .poll(
      async () => ((await (await request.get('/api/player-health')).json()) as unknown[]).length,
    )
    .toBe(2);
  const lateAdmin = await context.newPage();
  await lateAdmin.goto('/admin');
  await expect(lateAdmin.locator('.health-strip').first()).not.toContainText('unknown');
  await lateAdmin.close();
  const instanceIds = await players.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-instance-id')),
  );
  const positions = await players.evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-position')),
  );
  const first = admin.locator('[data-testid="admin-tile"]').filter({ hasText: 'Audio First' });
  const second = admin.locator('[data-testid="admin-tile"]').filter({ hasText: 'Audio Second' });

  await first.getByRole('button', { name: 'Muted' }).click();
  await expect(players.nth(0)).toHaveAttribute('data-muted', 'false');
  await expect(players.nth(1)).toHaveAttribute('data-muted', 'true');
  await first.getByRole('button', { name: 'Pause' }).click();
  await expect(players.nth(0)).toHaveAttribute('data-playing', 'false');
  await first.getByRole('button', { name: 'Play' }).click();
  await expect(first.getByRole('button', { name: 'Wall audio needs activation' })).toBeVisible();
  await expect(wall.getByRole('button', { name: /Enable Audio/ })).toBeVisible();
  await wall.getByRole('button', { name: /Enable Audio/ }).click();
  await expect(wall.getByRole('button', { name: /Enable Audio/ })).toHaveCount(0);
  await expect(players.nth(0)).toHaveAttribute('data-playing', 'true');

  await second.getByRole('button', { name: 'Muted' }).click();
  await expect(players.nth(0)).toHaveAttribute('data-muted', 'true');
  await expect(players.nth(1)).toHaveAttribute('data-muted', 'false');
  await expect(players.nth(0)).toHaveAttribute('data-playing', 'true');
  await expect(players.nth(1)).toHaveAttribute('data-playing', 'true');
  expect(
    await players.evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-instance-id')),
    ),
  ).toEqual(instanceIds);
  expect(
    await players.evaluateAll((items) => items.map((item) => item.getAttribute('data-position'))),
  ).toEqual(positions);
  await context.close();
});
