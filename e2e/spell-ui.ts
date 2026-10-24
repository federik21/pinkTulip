import { expect, type Locator } from '@playwright/test';

// Accessible icons may be nested in the type badge. Check the complete label
// independently of decorative glyphs, not with a weaker substring assertion.
export async function expectSpellType(badge: Locator, label: string) {
  await expect(badge).toBeVisible();
  await expect.poll(() => badge.evaluate(element => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[role="img"]').forEach(icon => icon.remove());
    return copy.textContent?.replace(/\s+/g, ' ').trim();
  })).toBe(label);
}

export async function expectSpellIcon(card: Locator, label: string) {
  const icon = card.getByRole('img', { name: `${label} spell`, exact: true });
  await expect(icon).toHaveCount(1); await expect(icon).toBeVisible();
  if (label === 'Trap') {
    expect(await icon.evaluate(element => element.tagName.toLowerCase())).toBe('svg');
    expect(await icon.locator('path, polygon, polyline').count()).toBeGreaterThan(0);
    await expect(icon).not.toContainText('🪤');
  } else {
    const glyph = label === 'Combat' ? '⚡' : label === 'Contingency' ? '🔮' : '🛡';
    await expect(icon).toHaveText(new RegExp(`^${glyph}\uFE0F?$`));
  }
}