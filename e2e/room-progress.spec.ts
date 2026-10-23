import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1200 }, { width: 390, height: 844 }]) {
  test(`room progress stays centered inside each hex at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByLabel('Mage name').fill('Progress Warden');
    await page.getByLabel('Room name').fill(`progress-${viewport.width}-${Date.now()}`);
    await expect(page.getByRole('button', { name: 'Create room', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    await expect(page.locator('.lobby-panel')).toBeVisible();
    await expect(page.locator('.capacity-badge')).toHaveCount(19);
    await page.evaluate(() => document.fonts.ready);

    const geometry = await page.locator('.hex:not(.start-room)').evaluateAll(rooms => rooms.map(room => {
      const polygon = room.querySelector<SVGPolygonElement>('polygon')!;
      const badge = room.querySelector<SVGGElement>('.capacity-badge')!;
      const background = badge.querySelector<SVGRectElement>('.capacity-background')!;
      const fills = Array.from(badge.querySelectorAll<SVGRectElement>('.capacity-fill'));
      const counter = badge.querySelector<SVGTextElement>('.cube-count')!;
      const bounds = background.getBBox();
      const filled = fills.map(fill => fill.getBBox());
      const label = counter.getBBox();
      const toRoom = polygon.getScreenCTM()!.inverse().multiply(background.getScreenCTM()!);
      const corners = [
        new DOMPoint(bounds.x, bounds.y),
        new DOMPoint(bounds.x + bounds.width, bounds.y),
        new DOMPoint(bounds.x, bounds.y + bounds.height),
        new DOMPoint(bounds.x + bounds.width, bounds.y + bounds.height),
      ].map(point => point.matrixTransform(toRoom));
      const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(toRoom);
      return {
        room: room.getAttribute('data-room-id'),
        counterBounds: { x: label.x, y: label.y, width: label.width, height: label.height },
        backgroundBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        centered: Math.abs(center.x) < 0.1,
        insideHex: corners.every(point => polygon.isPointInFill(point)),
        counterInside: label.x >= bounds.x && label.x + label.width <= bounds.x + bounds.width &&
          label.y >= bounds.y && label.y + label.height <= bounds.y + bounds.height,
        fillInside: filled.every(fill => fill.x >= bounds.x && fill.x + fill.width <= bounds.x + bounds.width &&
          fill.y >= bounds.y && fill.y + fill.height <= bounds.y + bounds.height),
        empty: fills.every(fill => fill.width.baseVal.value === 0),
        compact: bounds.width <= 36 && bounds.height <= 12,
      };
    }));

    for (const badge of geometry) {
      expect(badge.centered, `${badge.room}: progress must be horizontally centered`).toBe(true);
      expect(badge.insideHex, `${badge.room}: progress must not overlap neighboring hexagons`).toBe(true);
      expect(badge.counterInside, `${badge.room}: cube counter must fit within the progress bar: ${JSON.stringify(badge)}`).toBe(true);
      expect(badge.fillInside, `${badge.room}: progress fill must fit within its background`).toBe(true);
      expect(badge.empty, `${badge.room}: the lobby has no contributed cubes`).toBe(true);
      expect(badge.compact, `${badge.room}: progress must keep its compact size`).toBe(true);
    }

    // On mobile the board scrolls horizontally; scrolling must not displace the bars.
    if (viewport.width < 720) {
      await page.locator('.board-viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    }
    const visibleBadge = page.locator('.capacity-badge').last();
    await visibleBadge.scrollIntoViewIfNeeded();
    const owner = await visibleBadge.evaluate(badge => {
      const rect = badge.querySelector('.capacity-background')!.getBoundingClientRect();
      const topmost = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return topmost?.closest('.hex')?.getAttribute('data-room-id') === badge.closest('.hex')?.getAttribute('data-room-id');
    });
    expect(owner, 'The progress bar must not be hidden behind a neighboring hexagon').toBe(true);
    await testInfo.attach(`room-progress-${viewport.width}`, {
      body: await page.locator('.board-viewport').screenshot({ path: testInfo.outputPath('room-progress.png') }), contentType: 'image/png',
    });
    expect(errors).toEqual([]);
  });
}