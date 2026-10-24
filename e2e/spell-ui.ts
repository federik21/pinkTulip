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
  const badge = card.locator('.spell-type');
  const icon = badge.getByRole('img', { name: `${label} spell`, exact: true });
  await expect(icon).toHaveCount(1); await expect(icon).toBeVisible();
  await expect(badge.locator('.spell-type-icon')).toHaveCount(1);
  await expect(card.locator('.spell-type-icon')).toHaveCount(1);
  await expect(card.getByRole('img', { name: `${label} spell`, exact: true })).toHaveCount(1);
  await expect(card.locator('.spell-rune .spell-type-icon')).toHaveCount(0);
  if (label === 'Trap') {
    expect(await icon.evaluate(element => element.tagName.toLowerCase())).toBe('svg');
    expect(await icon.locator('path, polygon, polyline').count()).toBeGreaterThan(0);
    await expect(icon).not.toContainText('🪤');
  } else {
    const glyph = label === 'Combat' ? '⚡' : label === 'Contingency' ? '🔮' : '🛡';
    await expect(icon).toHaveText(new RegExp(`^${glyph}\uFE0F?$`));
  }
}

export async function expectSchoolIcon(container: Locator, school: { id: string; label: string; glyph: string }) {
  const icon = container.locator('.school-icon');
  await expect(icon).toHaveCount(1); await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('role', 'img');
  await expect(icon).toHaveAttribute('aria-label', school.label);
  await expect(icon).toHaveAttribute('data-school-id', school.id);
  await expect(icon).toHaveText(school.glyph);
  await expect(container.getByRole('img', { name: school.label, exact: true })).toHaveCount(1);
  return icon;
}