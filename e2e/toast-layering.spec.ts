import { expect, test } from '@playwright/test';
import { createGame } from '../packages/game-engine/src';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`control banner and room picker layer over toasts at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const game = createGame(2);
    game.gameId = 'toast-layering';
    game.phase = 'ACTION';
    game.currentPlayerId = game.firstPlayerId = game.players[0].id;
    game.players.forEach(player => { player.connected = true; });
    const me = game.players[0];
    const card = game.library[0].cards.shift()!;
    me.prepared.slot1 = { card, used: false };
    game.activation = { playerId: me.id, actionsUsed: 0, exploring: 0, sequencedSpellUsed: false,
      spellsCast: 0, discardedExit: false, roomEffectUsed: false, physicalAction: null };

    let publish = () => {};
    await page.routeWebSocket('**', route => {
      publish = () => route.send(JSON.stringify({ type: 'STATE', state: game }));
      route.onMessage(data => {
        if (JSON.parse(String(data)).type === 'CREATE_ROOM') {
          route.send(JSON.stringify({ type: 'WELCOME', playerId: me.id, roomId: game.gameId }));
          publish();
        }
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Online play', exact: true }).click();
    await page.getByRole('button', { name: 'Create room', exact: true }).click();
    const phaseOverlay = page.locator('.phase-overlay');
    if (await phaseOverlay.isVisible()) { await expect(phaseOverlay).toBeVisible(); await phaseOverlay.click(); await expect(phaseOverlay).toBeHidden(); }

    const toast = page.locator('.toast').first();
    await expect(toast).toBeVisible();

    const room = game.board.rooms.find(candidate => !candidate.startingFor && !candidate.reconstructed);
    expect(room).toBeDefined();
    me.wizard.position = { ...room!.tiles[0] };
    room!.effect = 'INSTABILITY';
    game.activation!.physicalAction = { kind: 'EXPLORE', mainEffectUsed: false, movementStarted: false };
    publish();
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: 'Open physical actions', exact: true }).click();
    const controlBanner = page.locator('.control-banner.is-floating');
    await expect(controlBanner).toBeVisible();
    const toastZ = Number(await toast.evaluate(element => getComputedStyle(element).zIndex));
    expect(Number(await controlBanner.evaluate(element => getComputedStyle(element).zIndex))).toBeGreaterThan(toastZ);
    expect(Number(await page.locator('.turn-banner').evaluate(element => getComputedStyle(element).zIndex))).toBeGreaterThan(toastZ);

    const activateRoom = page.locator('.turn-banner .physical-shortcuts').getByRole('button', { name: 'Activate room', exact: true });
    await expect(activateRoom).toBeEnabled();
    await activateRoom.click();
    const roomPicker = page.getByRole('group', { name: 'Choose a room on the map', exact: true });
    await expect(roomPicker).toBeVisible();
    await expect(roomPicker.getByRole('button', { name: 'Confirm room', exact: true })).toBeVisible();
    await expect(toast).toBeVisible();
    expect(Number(await page.locator('.turn-banner').evaluate(element => getComputedStyle(element).zIndex))).toBeGreaterThan(toastZ);
  });
}
