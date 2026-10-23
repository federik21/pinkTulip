import { test, expect, Page } from '@playwright/test';

type Mage = { page: Page; id: string; name: string; coordinates: string };

async function dismissOverlay(page: Page) {
  const overlay = page.locator('.phase-overlay');
  if (await overlay.isVisible()) await overlay.click();
  await expect(overlay).toBeHidden();
}

function hex(page: Page, coordinates: string, reachable = false) {
  return page.locator(reachable ? 'g.hex.reachable' : 'g.hex').filter({
    has: page.locator('text.coordinate', { hasText: new RegExp(`^${coordinates}$`) }),
  });
}

function player(page: Page, name: string) {
  return page.locator('.player').filter({
    has: page.locator('.player-heading', { hasText: name }),
  });
}

async function expectTokens(page: Page, name: string, tokens: number) {
  await expect(player(page, name).locator('.player-stats > span').filter({ hasText: /^⚡/ }))
    .toHaveText(`⚡ ${tokens}`);
}

async function expectRemovedControls(page: Page) {
  await expect(page.getByRole('button', { name: /^Summon\b/ })).toHaveCount(0);
  await expect(page.getByLabel('Free room effect timing', { exact: true })).toHaveCount(0);
}

async function expectActing(pages: Page[], mage: Mage, activity = 'Taking an Action turn') {
  for (const page of pages) {
    const banner = page.locator('.turn-banner');
    await expect(banner).toHaveCount(1);
    await expect(banner).toBeVisible();
    await expect(banner.locator('strong')).toHaveText(mage.name);
    await expect(banner.locator('.eyebrow')).toHaveText(page === mage.page ? 'Your turn' : 'Mage acting');
    await expect(banner.locator('small')).toHaveText(activity);
    await expect(page.locator('.player.active-player')).toHaveCount(1);
    await expect(page.locator('.player.active-player')).toHaveAttribute('data-player-id', mage.id);
    await expect(player(page, mage.name)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.player[aria-current="true"]')).toHaveCount(1);
    const token = page.locator('.board .acting-mage-token[data-mage-id]');
    await expect(token).toHaveCount(1);
    await expect(token).toHaveAttribute('data-mage-id', mage.id);
    await expect(page.locator('g.hex.acting-room')).toHaveCount(1);
    await expect(page.locator(`g.hex.acting-room .acting-mage-token[data-mage-id="${mage.id}"]`)).toHaveCount(1);
    await expect(token).toHaveCSS('animation-name', 'mage-breathe');
    await expect(token).toHaveCSS('animation-iteration-count', 'infinite');
    await expect(token).toHaveCSS('filter', /drop-shadow/);
    await expect(banner.locator(':scope > .acting-mage-icon')).toHaveCSS('animation-name', 'mage-breathe');
    await expect(page.locator('.player.active-player')).toHaveCSS('animation-name', 'mage-glow');
    await expect(page.locator('.board [data-mage-id]:not(.acting-mage-token)')).toHaveCount(1);
    await expect(page.locator('.board [data-mage-id]:not(.acting-mage-token)')).toHaveCSS('animation-name', 'none');
    await expectRemovedControls(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
}

async function expectNoActingMage(pages: Page[]) {
  for (const page of pages) {
    await expect(page.locator('.turn-banner, .player.active-player, .acting-mage-token, g.hex.acting-room')).toHaveCount(0);
    await expect(page.locator('.player[aria-current="true"]')).toHaveCount(0);
  }
}

async function expectMageAt(pages: Page[], mage: Mage, coordinates: string) {
  for (const page of pages) {
    await expect(hex(page, coordinates).locator(`[data-mage-id="${mage.id}"]`)).toHaveCount(1);
    await expect(hex(page, coordinates)).toHaveAttribute('aria-label', new RegExp(mage.name));
  }
}

async function expectPhase(pages: Page[], phase: string) {
  for (const page of pages) {
    await expect(page.locator('.phase-track .current span')).toHaveText(phase);
    await dismissOverlay(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
}

async function studyAndPrepare(pages: Page[]) {
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Six schools. Infinite possibilities.', exact: true })).toBeVisible();
    await dismissOverlay(page);
    await page.getByRole('button', { name: /School 1\b/ }).click();
    await expect(page.locator('.phase-panel .spell')).toHaveCount(6);
    await page.locator('.phase-panel .spell').nth(4).click();
    await page.locator('.phase-panel .spell').nth(5).click();
    await page.getByRole('button', { name: 'Discard selected (2/2)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Discard selected (2/2)', exact: true })).toHaveCount(0);
  }
  for (const page of pages) {
    await expect(page.getByRole('heading', { name: 'Three ordered spells. One wild card.', exact: true })).toBeVisible();
    await dismissOverlay(page);
    await expect(page.locator('.phase-panel .spell')).toHaveCount(4);
    for (let i = 0; i < 4; i++) await page.locator('.phase-panel .spell').nth(i).click();
    await page.getByRole('button', { name: 'Prepare spells', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Prepare spells', exact: true })).toHaveCount(0);
  }
  await expectPhase(pages, 'Action');
}

async function expectGreySummon(mage: Mage, pages: Page[], total: number) {
  const own = mage.page.locator('.evocations-panel .evocation-card[data-owned="true"]');
  await expect(own).toHaveCount(1);
  const id = await own.getAttribute('data-evocation-id');
  expect(id).toBeTruthy();
  for (const page of pages) {
    const model = page.locator(`.evocations-panel .evocation-card[data-evocation-id="${id}"]`);
    await expect(model.locator(':scope > small')).toHaveText(`${mage.name} · Undead · ${mage.coordinates}`);
    await expect(model.locator('.model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2']);
    await expect(model).toContainText('Wounded Fury: +1 attack per damage taken.');
    await expect(hex(page, mage.coordinates).locator('.evocation-marker')).toHaveText('☠1');
    await expect(page.locator('.evocations-panel .evocation-card')).toHaveCount(total);
    await expect(page.locator('.log > div').filter({ hasText: `${mage.name} summons a Cadaver from the Grey room (Undead · move 2 · attack 2 · health 2).` }))
      .toBeVisible();
    await expectTokens(page, mage.name, 1);
    await expectRemovedControls(page);
  }
  await expect(mage.page.locator('.phase-panel .badge')).toHaveText('1 physical actions left');
  await expect(own.getByRole('button', { name: /^Activate Cadaver\b/ })).toBeEnabled();
  return id!;
}

async function extraEvocationActivation(mage: Mage, pages: Page[], id: string, total: number) {
  const own = mage.page.locator(`.evocation-card[data-evocation-id="${id}"]`);
  const activate = own.getByRole('button', { name: /^Activate Cadaver\b/ });
  await expect(activate.locator('small')).toHaveText('1 token · extra activation');
  await expect(activate).toBeEnabled();
  await activate.click();
  await expectActing(pages, mage, 'Controlling an evocation');
  await expect(own).toHaveClass(/active-model/);
  await expect(mage.page.getByRole('heading', { name: 'Finish your evocation activation', exact: true })).toBeVisible();
  await expect(mage.page.locator('.evocation-controls')).toContainText('2 movement remaining.');
  const observer = pages.find(page => page !== mage.page)!;
  await expect(observer.getByRole('button', { name: 'Finish evocation', exact: true })).toHaveCount(0);
  await expect(observer.locator('g.hex.reachable')).toHaveCount(0);
  for (const page of pages) {
    await expectTokens(page, mage.name, 0);
    await expect(page.locator('.evocation-card')).toHaveCount(total);
    await expect(page.locator(`[data-evocation-id="${id}"] > small`)).toHaveText(`${mage.name} · Undead · ${mage.coordinates}`);
  }
  await expect(activate).toBeDisabled();
  // Spend the extra activation without moving or attacking; it must not summon another model.
  await mage.page.getByRole('button', { name: 'Finish evocation', exact: true }).click();
  await expectActing(pages, mage);
  for (const page of pages) {
    await expect(page.locator('.evocation-controls')).toHaveCount(0);
    await expect(page.locator('.evocation-card')).toHaveCount(total);
    await expect(page.locator(`[data-evocation-id="${id}"] > small`)).toHaveText(`${mage.name} · Undead · ${mage.coordinates}`);
    await expect(page.locator('.log > div').filter({ hasText: `${mage.name} summons a Cadaver from the Grey room` })).toHaveCount(1);
    await expectTokens(page, mage.name, 0);
  }
  await expect(mage.page.locator('.phase-panel .badge')).toHaveText('0 physical actions left');
  await expect(mage.page.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
  await expect(activate).toBeDisabled();
  await expect(mage.page.getByRole('button', { name: /^Begin movement\b/ })).toBeDisabled();
  await expect(mage.page.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeDisabled();
}

// Read only visible turn/phase controls. No injected state, socket commands, or server shortcuts.
async function drainFreeSpells(mages: Mage[]) {
  const pages = mages.map(mage => mage.page);
  let casts = 0;
  let checkedNumberedQuota = false;
  let castFlexible = false;
  for (let step = 0; step < 16; step++) {
    // Broadcasts can arrive at the two browsers a frame apart. Wait for a coherent owner.
    await expect.poll(async () => {
      const phases = await Promise.all(pages.map(page => page.locator('.phase-track .current span').innerText()));
      if (phases.every(phase => phase === 'Evocation')) return true;
      if (!phases.every(phase => phase === 'Action')) return false;
      const turns = await Promise.all(pages.map(page => page.getByRole('heading', { name: 'Choose your next action', exact: true }).isVisible()));
      const owners = await Promise.all(pages.map(page => page.locator('.player.active-player .player-heading > span').innerText()));
      const actor = turns.findIndex(Boolean);
      return turns.filter(Boolean).length === 1 && owners.every(owner => owner.includes(mages[actor].name));
    }, { message: 'Action must have one visible acting mage, or both browsers must enter Evocation' }).toBe(true);

    if (await pages[0].locator('.phase-track .current span').innerText() === 'Evocation') {
      expect(casts, 'All seven remaining preparations must be cast before Action ends').toBe(7);
      expect(checkedNumberedQuota, 'A numbered cast must lock later numbered slots on that turn').toBe(true);
      expect(castFlexible, 'Flexible spells must remain usable alongside a numbered spell').toBe(true);
      for (const page of pages) {
        await expect(page.locator('.prepared')).toHaveCount(0);
        await expect(page.locator('.log > div').filter({ hasText: /passes for the rest of the Action phase/ })).toHaveCount(0);
      }
      return;
    }

    const mage = (await Promise.all(mages.map(async candidate =>
      await candidate.page.getByRole('heading', { name: 'Choose your next action', exact: true }).isVisible() ? candidate : undefined
    ))).find((candidate): candidate is Mage => !!candidate)!;
    const { page } = mage;
    await expectActing(pages, mage);
    await expectTokens(page, mage.name, 0);
    await expect(page.locator('.phase-panel .badge')).toHaveText('0 physical actions left');
    await expect(page.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Begin movement\b/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeDisabled();
    await expectRemovedControls(page);
    const enabled = page.locator('.prepared .spell:not(:disabled)');
    expect(await enabled.count(), `${mage.name} has no tokens: exhaustion must hand off rather than strand future slots`).toBeGreaterThan(0);
    expect(await enabled.filter({ hasText: /Spell [123] ·/ }).count()).toBeLessThanOrEqual(1);
    const card = enabled.first();
    const label = (await card.locator('.eyebrow').textContent())!.trim();
    const numbered = /^Spell [123] ·/.test(label);
    const model = label.endsWith(' · Model');
    const usedBefore = await page.locator('.prepared .spell.used').count();
    await card.click();
    if (model) await page.getByRole('button', { name: 'Target dummy · no damage', exact: true }).click();
    // Room spells ignore friendlies; model spells use a dummy. Neither can kill either summon.
    await hex(page, mage.coordinates, true).click();
    await page.locator('.room-detail').getByRole('button', { name: /^Cast .* here/ }).click();
    await expect.poll(async () =>
      await page.locator('.phase-track .current span').innerText() === 'Evocation' ||
      await page.locator('.prepared .spell.used').count() === usedBefore + 1,
      { message: 'A free cast must spend its preparation or exhaust Action into Evocation' }
    ).toBe(true);
    casts++;
    if (!numbered) castFlexible = true;
    if (numbered && await page.locator('.prepared .spell:not(:disabled)').filter({ hasText: '✧ Flexible' }).count()) {
      await expect(page.locator('.prepared .spell:not(:disabled)').filter({ hasText: /Spell [123] ·/ })).toHaveCount(0);
      checkedNumberedQuota = true;
    }
    for (const observer of pages) {
      await expect(observer.getByRole('alert')).toHaveCount(0);
      await expectTokens(observer, mage.name, 0);
    }
  }
  throw new Error(`Action did not exhaust within 16 visible spell casts (${casts} casts completed)`);
}

test('two browsers exhaust two round tokens, cast free spells, and resolve evocations through visible controls', async ({ browser }, testInfo) => {
  const a = await browser.newPage({ reducedMotion: 'no-preference' }), b = await browser.newPage({ reducedMotion: 'no-preference' });
  const pages = [a, b];
  const ember: Mage = { page: a, id: 'p1', name: 'Ember Browser', coordinates: '1,-1' };
  const moon: Mage = { page: b, id: 'p2', name: 'Moon Browser', coordinates: '-2,1' };
  const pageErrors: string[][] = [[], []];
  const dialogs: string[][] = [[], []];
  pages.forEach((page, i) => {
    page.on('pageerror', error => pageErrors[i].push(error.message));
    page.on('dialog', async dialog => { dialogs[i].push(dialog.message()); await dialog.dismiss(); });
  });
  try {
    await test.step('Join, ready, Study, and prepare four spells each', async () => {
      await a.goto('/');
      await b.goto('/');
      const room = `browser-round-${testInfo.workerIndex}-${testInfo.retry}`;
      await a.getByLabel('Mage name').fill(ember.name);
      await a.getByLabel('Room name').fill(room);
      await a.getByRole('button', { name: 'Create room', exact: true }).click();
      await expect(a.getByRole('heading', { name: 'Gather the mages', exact: true })).toBeVisible();
      await expect(a.getByRole('button', { name: 'Start game', exact: true })).toBeDisabled();
      await a.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await b.getByLabel('Mage name').fill(moon.name);
      await b.getByLabel('Room name').fill(room);
      await b.getByRole('button', { name: 'Join room', exact: true }).click();
      await b.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await a.getByRole('button', { name: 'Start game', exact: true }).click();
      await expectPhase(pages, 'Black Rose');
      await expectNoActingMage(pages);
      await a.getByRole('button', { name: 'Receive quests & begin Study', exact: false }).click();
      await studyAndPrepare(pages);
    });

    await test.step('Both clients identify the acting mage; pulse and glow respect reduced motion', async () => {
      await expectActing(pages, ember);
      await expectMageAt(pages, ember, '3,-2');
      await expectMageAt(pages, moon, '-3,2');
      for (const page of pages) {
        // Inspect the rendered animation, not application state or a synthetic command.
        await expect.poll(() => page.locator('.acting-mage-token').evaluate(element =>
          element.getAnimations().some(animation => animation instanceof CSSAnimation &&
            animation.animationName === 'mage-breathe' && animation.effect instanceof KeyframeEffect &&
            new Set(animation.effect.getKeyframes().map(frame => frame.transform)).size > 1)
        )).toBe(true);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        for (const locator of [page.locator('.acting-mage-token'), page.locator('.player.active-player'),
          page.locator('.turn-banner > .acting-mage-icon'), page.locator('.active-player .acting-mage-icon')]) {
          await expect(locator).toHaveCSS('animation-name', 'none');
          await expect(locator).toHaveCSS('transition-duration', '0s');
        }
        await expect(page.locator('.acting-mage-token')).toHaveAttribute('data-mage-id', ember.id);
        await expect(page.locator('.turn-banner strong')).toHaveText(ember.name);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
      }
      await expectActing(pages, ember);
      await a.screenshot({ path: testInfo.outputPath('action-acting-ember-desktop.png'), fullPage: true });
    });

    let emberId = '', moonId = '';
    await test.step('Spend exactly two tokens per mage, retaining spells instead of passing', async () => {
      await expect(a.getByRole('heading', { name: 'Choose your next action', exact: true })).toBeVisible();
      for (const page of pages) {
        for (const mage of [ember, moon]) await expectTokens(page, mage.name, 2);
        await expect(page.locator('g.hex.start-room')).toHaveCount(4);
        for (const coordinates of ['-1,-2', '3,-2', '-3,2', '1,2']) await expect(hex(page, coordinates)).toHaveClass(/start-room/);
        await expect(page.locator('g.hex')).toHaveCount(23);
        for (const color of ['crimson', 'azure', 'emerald', 'amber', 'violet', 'grey']) {
          await expect(page.locator(`g.hex[data-color="${color}"]`)).toHaveCount(3);
          await expect(page.locator(`.room-legend [data-color="${color}"]`)).toHaveText(`${color} · 3`);
        }
        await expect(page.locator('[data-color="ivory"]')).toHaveCount(0);
        await expectRemovedControls(page);
        await expect(page.locator('.evocation-card')).toHaveCount(0);
      }
      await expect(a.locator('.prepared .spell:not(:disabled)')).toHaveCount(0);
      await expect(a.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeDisabled();
      await expect(a.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
      // Exit options are flexible, then slots 1/2/3: discard only the third numbered preparation.
      await a.getByLabel('Card to discard for exit').selectOption({ index: 4 });
      await hex(a, '2,-2', true).click();
      await expect(a.locator('.log').getByText(/Ember Browser discards .*no token or action/)).toBeVisible();
      await expect(a.locator('.prepared .spell.used .eyebrow')).toHaveText(/^Spell 3 · (Room|Model)$/);
      await expectTokens(a, ember.name, 2);
      await expect(a.locator('.phase-panel .badge')).toHaveText('2 physical actions left');
      await expectMageAt(pages, ember, '2,-2');
      const emeraldCubes = (await hex(a, '1,-2').locator('.cube-count').textContent())!;
      await a.getByLabel('Emerald effect target').selectOption('room-1,-2');
      await a.getByRole('button', { name: /^Begin movement\b/ }).click();
      await expect(a.locator('.actions-panel .notice')).toContainText('Movement: 2 step(s) left.');
      await expectTokens(a, ember.name, 1);
      for (const page of pages) {
        await expect(hex(page, '1,-2').locator('.cube-count')).toHaveText(emeraldCubes);
        await expect(page.locator('.log > div').filter({ hasText: /Ember Browser activates .*for free/ })).toHaveCount(0);
      }
      await hex(a, ember.coordinates, true).click();
      // The first step is sent immediately, but entering Grey does not activate its effect.
      await expectMageAt(pages, ember, ember.coordinates);
      await expect(a.locator('.actions-panel .notice')).toContainText('Movement: 1 step(s) left.');
      await expect(a.getByRole('button', { name: 'Finish movement', exact: true })).toBeEnabled();
      await expect(a.getByRole('button', { name: 'Activate room & finish movement', exact: true })).toBeEnabled();
      await expect(a.getByRole('button', { name: 'Move here & activate room', exact: true })).toHaveCount(0);
      for (const page of pages) await expect(page.locator('.evocation-card')).toHaveCount(0);
      await a.getByRole('button', { name: 'Activate room & finish movement', exact: true }).click();
      emberId = await expectGreySummon(ember, pages, 1);
      await extraEvocationActivation(ember, pages, emberId, 1);
      await a.getByRole('button', { name: /^End turn\b/ }).click();

      await expect(b.getByRole('heading', { name: 'Choose your next action', exact: true })).toBeVisible();
      await expectActing(pages, moon);
      await expect(b.getByRole('button', { name: 'Pass for this round', exact: true })).toBeDisabled();
      await expect(b.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeDisabled();
      await b.getByRole('button', { name: /^Begin movement\b/ }).click();
      await expectTokens(b, moon.name, 1);
      await hex(b, '-2,2', true).click();
      await expectMageAt(pages, moon, '-2,2');
      await expect(b.locator('.actions-panel .notice')).toContainText('Movement: 1 step(s) left.');
      const beforeChoice = await b.locator('.log > div').allTextContents();
      await hex(b, moon.coordinates, true).click();
      await expect(b.locator('.actions-panel .notice')).toContainText('Final step: Room -2,1.');
      await expect(b.getByRole('button', { name: 'Move here without activating', exact: true })).toBeEnabled();
      await expect(b.getByRole('button', { name: 'Move here & activate room', exact: true })).toBeEnabled();
      await expectMageAt(pages, moon, '-2,2');
      for (const page of pages) {
        await expect(page.locator('.log > div')).toHaveText(beforeChoice);
        await expect(page.locator('.evocation-card')).toHaveCount(1);
        await expectTokens(page, moon.name, 1);
      }
      // Cancelling is local too: no final movement, room effect, or token is sent.
      await b.getByRole('button', { name: 'Choose another destination', exact: true }).click();
      await expect(b.getByRole('button', { name: 'Move here & activate room', exact: true })).toHaveCount(0);
      await expect(b.getByRole('button', { name: 'Finish movement', exact: true })).toBeEnabled();
      await expectMageAt(pages, moon, '-2,2');
      for (const page of pages) await expect(page.locator('.log > div')).toHaveText(beforeChoice);
      await hex(b, moon.coordinates, true).click();
      await b.getByRole('button', { name: 'Move here & activate room', exact: true }).click();
      await expectMageAt(pages, moon, moon.coordinates);
      await expect(b.getByRole('button', { name: 'Finish movement', exact: true })).toHaveCount(0);
      moonId = await expectGreySummon(moon, pages, 2);
      await extraEvocationActivation(moon, pages, moonId, 2);
      await b.screenshot({ path: testInfo.outputPath('action-acting-moon-desktop.png'), fullPage: true });
      await b.getByRole('button', { name: /^End turn\b/ }).click();
      await expectActing(pages, ember);
    });

    await test.step('Exhaust numbered and flexible spells for free; enter Evocation without a premature pass', async () => {
      await drainFreeSpells([ember, moon]);
      await expectPhase(pages, 'Evocation');
      await expectActing(pages, ember, 'Choosing an evocation');
      for (const page of pages) {
        await expect(page.getByRole('heading', { name: 'Evocation phase', exact: true })).toBeVisible();
        await expect(page.locator('.evocations-panel .evocation-card')).toHaveCount(2);
        await expect(page.locator('.evocations-panel .model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2', '↝ 2', '⚔ 2', '♥ 2/2']);
        await expect(hex(page, ember.coordinates).locator('.evocation-marker')).toHaveText('☠1');
        await expect(hex(page, moon.coordinates).locator('.evocation-marker')).toHaveText('☠1');
      }
    });

    await test.step('Activate sequentially, move two adjacent spaces, attack only enemies, and destroy a rival summon', async () => {
      const activateA = a.locator('.evocation-card[data-owned="true"]').getByRole('button', { name: /^Activate Cadaver\b/ });
      const activateB = b.locator('.evocation-card[data-owned="true"]').getByRole('button', { name: /^Activate Cadaver\b/ });
      await expect(activateA.locator('small')).toHaveText('Free · once this phase');
      await expect(activateA).toBeEnabled();
      await expect(activateB).toBeDisabled();
      await activateA.click();
      await expectActing(pages, ember, 'Controlling an evocation');
      for (const page of pages) await expectTokens(page, ember.name, 0);
      await expect(a.locator('.evocation-controls')).toContainText('2 movement remaining.');
      await expect(a.getByRole('button', { name: 'Finish evocation', exact: true })).toBeEnabled();
      await expect(activateA).toBeDisabled();
      await expect(activateB).toBeDisabled();
      await expect(b.getByRole('button', { name: 'Finish evocation', exact: true })).toHaveCount(0);
      await expect(b.locator('g.hex.reachable')).toHaveCount(0);
      await expect(a.locator('g.hex.start-room.reachable')).toHaveCount(0);
      await hex(a, '0,0', true).click();
      await expect(a.locator('.evocation-controls')).toContainText('1 movement remaining.');
      await expect(hex(a, '0,0').locator('.evocation-marker')).toHaveText('☠1');
      await hex(a, '-1,1', true).click();
      await expect(a.locator('.evocation-controls')).toContainText('0 movement remaining.');
      await expect(a.locator('g.hex.reachable')).toHaveCount(0);
      await expect(a.locator(`[data-evocation-id="${emberId}"] > small`)).toHaveText(`${ember.name} · Undead · -1,1`);
      await expect(hex(a, ember.coordinates)).toHaveAttribute('aria-label', new RegExp(ember.name));
      await expect(hex(a, ember.coordinates).locator('.evocation-marker')).toHaveCount(0);
      await expect(a.getByRole('button', { name: /^Cadaver attack Ember Browser\b/ })).toHaveCount(0);
      await expect(a.getByRole('button', { name: /^Cadaver attack Cadaver \(Ember Browser\)/ })).toHaveCount(0);
      const attackMage = a.getByRole('button', { name: /^Cadaver attack Moon Browser\b/ });
      await expect(attackMage.locator('small')).toHaveText('2 damage');
      await expect(a.getByRole('button', { name: /^Cadaver attack Cadaver \(Moon Browser\)/ })).toBeEnabled();
      await attackMage.click();
      await expectActing(pages, moon, 'Choosing an evocation');
      await expect(activateB).toBeEnabled();
      await expect(activateA).toBeDisabled();
      await expect(activateA.locator('small')).toHaveText('Already activated');
      for (const page of pages) {
        await expect(page.locator('.evocation-controls')).toHaveCount(0);
        await expect(player(page, moon.name).locator('.damage-ledger')).toContainText('Ember Browser: 2');
        await expect(player(page, ember.name).locator('.cube-pool')).toContainText('On mages: 2');
      }

      await activateB.click();
      await expectActing(pages, moon, 'Controlling an evocation');
      for (const page of pages) await expectTokens(page, moon.name, 0);
      await expect(b.locator('.evocation-controls')).toContainText('2 movement remaining.');
      await hex(b, '-1,1', true).click();
      await expect(b.locator('.evocation-controls')).toContainText('1 movement remaining.');
      await expect(hex(b, '-1,1').locator('.evocation-marker')).toHaveText('☠2');
      await expect(b.getByRole('button', { name: /^Cadaver attack Moon Browser\b/ })).toHaveCount(0);
      await expect(b.getByRole('button', { name: /^Cadaver attack Cadaver \(Moon Browser\)/ })).toHaveCount(0);
      const availableBefore = await player(b, moon.name).locator('[title="Available cubes"]').innerText();
      const attackModel = b.getByRole('button', { name: /^Cadaver attack Cadaver \(Ember Browser\)/ });
      await expect(attackModel.locator('small')).toHaveText('2 damage');
      await attackModel.click();
      await expectPhase(pages, 'Cleanup');
      await expectNoActingMage(pages);
      for (const page of pages) {
        await expect(page.getByRole('heading', { name: '❖ The lodge settles', exact: true })).toBeVisible();
        await expect(page.locator(`[data-evocation-id="${emberId}"]`)).toHaveCount(0);
        await expect(page.locator(`[data-evocation-id="${moonId}"]`)).toHaveCount(1);
        await expect(page.locator('.evocation-controls')).toHaveCount(0);
        await expect(hex(page, '-1,1').locator('.evocation-marker')).toHaveText('☠1');
        await expect(page.locator('.log').getByText(/Cadaver is destroyed; its damage cubes return to their owners/)).toBeVisible();
        await expect(player(page, moon.name).locator('.cube-pool')).toContainText('On evocations: 0');
      }
      // Cleanup may also return room cubes, but no damage cubes may remain on the destroyed model.
      const availableAfter = await player(b, moon.name).locator('[title="Available cubes"]').innerText();
      expect(Number(availableAfter.replace('◆ ', ''))).toBeGreaterThanOrEqual(Number(availableBefore.replace('◆ ', '')));
      await a.screenshot({ path: testInfo.outputPath('cleanup-desktop.png'), fullPage: true });
    });

    await test.step('Refresh two tokens next round, preserve the surviving model, and fit mobile screens', async () => {
      await a.getByRole('button', { name: 'Begin round 2', exact: false }).click();
      await expectPhase(pages, 'Black Rose');
      await expectNoActingMage(pages);
      for (const [i, page] of pages.entries()) {
        await expect(page.locator('.event-panel')).toContainText('Round 2');
        for (const mage of [ember, moon]) await expectTokens(page, mage.name, 2);
        const survivor = page.locator(`.evocation-card[data-evocation-id="${moonId}"]`);
        await expect(survivor).toHaveCount(1);
        await expect(survivor.locator(':scope > small')).toHaveText(`${moon.name} · Undead · -1,1`);
        await expect(survivor.locator('.model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2']);
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(hex(page, '-1,1').locator('.evocation-marker')).toHaveText('☠1');
        await survivor.scrollIntoViewIfNeeded();
        await expect(survivor).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          { message: `${i === 0 ? ember.name : moon.name}: mobile layout must not overflow horizontally` }).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`round-two-mobile-${i + 1}.png`), fullPage: true });
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(pageErrors[i], `Uncaught errors in browser ${i + 1}`).toEqual([]);
        expect(dialogs[i], `Unexpected dialogs in browser ${i + 1}`).toEqual([]);
      }
    });
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
});

test('Grey activation is explicit at rest and optional at the final movement destination', async ({ browser }, testInfo) => {
  const a = await browser.newPage({ reducedMotion: 'no-preference' }), b = await browser.newPage({ reducedMotion: 'no-preference' });
  const pages = [a, b];
  const ember: Mage = { page: a, id: 'p1', name: 'Grey Ember', coordinates: '1,-1' };
  const moon: Mage = { page: b, id: 'p2', name: 'Grey Moon', coordinates: '-3,2' };
  const pageErrors: string[] = [], dialogs: string[] = [];
  for (const page of pages) {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  }
  try {
    await test.step('Prepare a fresh game using only the lobby and spell controls', async () => {
      await Promise.all(pages.map(page => page.goto('/')));
      const room = `browser-grey-${testInfo.workerIndex}-${testInfo.retry}`;
      await a.getByLabel('Mage name').fill(ember.name);
      await a.getByLabel('Room name').fill(room);
      await a.getByRole('button', { name: 'Create room', exact: true }).click();
      await a.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await b.getByLabel('Mage name').fill(moon.name);
      await b.getByLabel('Room name').fill(room);
      await b.getByRole('button', { name: 'Join room', exact: true }).click();
      await b.getByRole('button', { name: 'Mark ready', exact: true }).click();
      await a.getByRole('button', { name: 'Start game', exact: true }).click();
      await expectPhase(pages, 'Black Rose');
      await a.getByRole('button', { name: 'Receive quests & begin Study', exact: false }).click();
      await studyAndPrepare(pages);
      await expectActing(pages, ember);
    });

    await test.step('Decline the final Grey effect: confirmation is local and arrival summons nothing', async () => {
      await expect(a.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeDisabled();
      await a.getByRole('button', { name: /^Begin movement\b/ }).click();
      await hex(a, '2,-2', true).click();
      await expectMageAt(pages, ember, '2,-2');
      await expect(a.locator('.actions-panel .notice')).toContainText('Movement: 1 step(s) left.');
      const beforeChoice = await a.locator('.log > div').allTextContents();
      await hex(a, ember.coordinates, true).click();
      await expect(a.getByRole('button', { name: 'Move here without activating', exact: true })).toBeEnabled();
      await expect(a.getByRole('button', { name: 'Move here & activate room', exact: true })).toBeEnabled();
      await expect(a.getByRole('button', { name: 'Choose another destination', exact: true })).toBeEnabled();
      await expect(b.getByRole('button', { name: 'Move here without activating', exact: true })).toHaveCount(0);
      await expectMageAt(pages, ember, '2,-2');
      for (const page of pages) {
        await expect(page.locator('.log > div')).toHaveText(beforeChoice);
        await expect(page.locator('.evocation-card')).toHaveCount(0);
        await expectTokens(page, ember.name, 1);
      }
      await a.screenshot({ path: testInfo.outputPath('grey-final-step-confirmation-desktop.png'), fullPage: true });
      await a.getByRole('button', { name: 'Move here without activating', exact: true }).click();
      await expectMageAt(pages, ember, ember.coordinates);
      await expectActing(pages, ember);
      await expect(a.getByRole('button', { name: 'Finish movement', exact: true })).toHaveCount(0);
      await expect(a.getByRole('button', { name: 'Move here & activate room', exact: true })).toHaveCount(0);
      await expect(a.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeEnabled();
      for (const page of pages) {
        await expect(page.locator('.evocation-card')).toHaveCount(0);
        await expect(page.locator('.log > div').filter({ hasText: /Grey Ember activates .*for free/ })).toHaveCount(0);
        await expectTokens(page, ember.name, 1);
      }
    });

    await test.step('Activate Grey at rest, spend only the Explore token, and never activate twice', async () => {
      await a.getByRole('button', { name: /^Activate room\s+1 token/ }).click();
      await expect(a.locator('.actions-panel .notice')).toContainText('Movement: 2 step(s) left.');
      await expect(a.locator('.actions-panel .notice')).toContainText('Free room effect already used.');
      await expect(a.getByRole('button', { name: 'Activate room & finish movement', exact: true })).toBeDisabled();
      await expect(a.getByRole('button', { name: 'Finish movement', exact: true })).toBeEnabled();
      for (const page of pages) {
        await expect(page.locator('.evocation-card')).toHaveCount(1);
        await expect(page.locator('.evocation-card > small')).toHaveText(`${ember.name} · Undead · ${ember.coordinates}`);
        await expect(page.locator('.model-stats > span')).toHaveText(['↝ 2', '⚔ 2', '♥ 2/2']);
        await expect(hex(page, ember.coordinates).locator('.evocation-marker')).toHaveText('☠1');
        await expectTokens(page, ember.name, 0);
      }
      await a.getByRole('button', { name: 'Finish movement', exact: true }).click();
      await expect(a.getByRole('button', { name: 'Finish movement', exact: true })).toHaveCount(0);
      await expect(a.locator('.phase-panel .badge')).toHaveText('0 physical actions left');
      await expect(a.getByRole('button', { name: /^Activate Cadaver\b/ })).toBeDisabled();
      await expect(a.getByRole('button', { name: /^Activate room\s+1 token/ })).toBeDisabled();
      for (const page of pages) {
        await expect(page.locator('.evocation-card')).toHaveCount(1);
        await expect(page.locator('.log > div').filter({ hasText: /Grey Ember summons a Cadaver from the Grey room/ })).toHaveCount(1);
        await expect(page.locator('.log > div').filter({ hasText: /Grey Ember activates Room 1,-1 for free/ })).toHaveCount(1);
      }
      await a.getByRole('button', { name: /^End turn\b/ }).click();
      await expectActing(pages, moon);
      await expectMageAt(pages, moon, moon.coordinates);
    });

    await test.step('The active turn banner and highlighted board also fit on mobile', async () => {
      for (const [i, page] of pages.entries()) {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.locator('.turn-banner')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          { message: `Browser ${i + 1}: the acting banner and retinue must not overflow on mobile` }).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`grey-at-rest-action-mobile-${i + 1}.png`), fullPage: true });
        await expectRemovedControls(page);
        await expect(page.getByRole('alert')).toHaveCount(0);
      }
      await expectActing(pages, moon);
      expect(pageErrors, 'Uncaught browser errors').toEqual([]);
      expect(dialogs, 'Unexpected browser dialogs').toEqual([]);
    });
  } finally {
    await Promise.all(pages.map(page => page.close()));
  }
});