import { describe, expect, it } from 'vitest';
import { applyAction, createGame, createHexDeck, getDarkSide, upgradeLegacyCards } from '../src';
import type { GameState, JinxName } from '../src';

const activation = (playerId: string) => ({ playerId, actionsUsed: 0, exploring: 0, spellsCast: 0, sequencedSpellUsed: false, discardedExit: false, roomEffectUsed: false });
function fixture(): GameState {
 const s = createGame(2), origin = s.board.rooms.find(room => room.id === 'room-0,0')!.tiles[0];
 s.phase = 'ACTION'; s.round = 1; s.currentPlayerId = 'p1'; s.firstPlayerId = 'p1'; s.activation = activation('p1');
 for (const p of s.players) { p.wizard.position = { ...origin }; p.wizard.health = 30; }
 return s;
}
const jinx = (name: JinxName) => ({ id: `j-${name}`, name, cubes: 0 });
const hexCard = (name: string) => createHexDeck('hex', 'hex').find(card => card.name === name)!;
const cast = (s: GameState, name: string) => {
 s.players[0].prepared.rapid = { card: hexCard(name), used: false, side: 'DARK' };
 let after = applyAction(s, { type: 'CAST_SPELL', playerId: 'p1', slot: 'rapid', targetPlayerId: 'p2' });
 while (after.pendingDecision?.kind === 'CHOICE') after = applyAction(after, { type: 'RESPOND_CHOICE', playerId: after.pendingDecision.playerId, key: after.pendingDecision.key, choiceId: after.pendingDecision.options[0].id });
 return after;
};

describe('Hex dark sides', () => {
 it('gives ten Hex cards a dark side and keeps the other two light-only', () => {
  const cards = createHexDeck('hex', 'hex');
  const names = [...new Set(cards.map(card => card.name))];
  expect(names).toHaveLength(12);
  for (const name of names) {
   const card = hexCard(name);
   if (['ca\u2019Dario\u2019s amulet', 'Cerebral worm'].includes(name)) expect(card.lightOnly).toBe(true);
   else { expect(card.darkSide).toBeDefined(); expect(getDarkSide(card).rulesText).toBeTruthy(); }
  }
  const saved = JSON.parse(JSON.stringify(hexCard('Curse')));
  delete saved.darkSide; upgradeLegacyCards(saved);
  expect(saved.darkSide.range).toBe(3);
 });

 it('Curse inflicts 1 damage, or 3 against a jinxed target, then converts', () => {
  expect(cast(fixture(), 'Curse').players[1].wizard.damageCubes).toBe(1);
  const s = fixture(); s.players[1].jinxes = [jinx('OBLIVION')];
  expect(cast(s, 'Curse').players[1].wizard.damageCubes).toBe(3);
 });

 it('Feverish dream deals 2 more and costs the target a jinx and 1 VP', () => {
  const s = fixture(); s.players[1].jinxes = [jinx('OBLIVION')]; s.players[1].victoryPoints = 3;
  const after = cast(s, 'Feverish dream');
  expect(after.players[1].jinxes).toHaveLength(0);
  expect(after.players[1].wizard.damageCubes).toBe(4);
  expect(after.players[1].victoryPoints).toBe(2);
  const bare = cast(fixture(), 'Feverish dream');
  expect(bare.players[1].wizard.damageCubes).toBe(2);
 });

 it('Crypt fever converts BR damage, and pays 1 VP per converted BR cube when the target discards a jinx', () => {
  const s = fixture(); s.players[1].jinxes = [jinx('OBLIVION')];
  s.players[1].wizard.damageCubes = 3; s.players[1].wizard.blackDamage = 3; s.players[1].wizard.damageOrder = ['black-rose', 'black-rose', 'black-rose'];
  const after = cast(s, 'Crypt fever');
  expect(after.players[1].jinxes).toHaveLength(0);
  expect(after.players[1].wizard.blackDamage).toBe(0);
  expect(after.players[0].victoryPoints - s.players[0].victoryPoints).toBe(3);
  const noJinx = fixture();
  noJinx.players[1].wizard.damageCubes = 3; noJinx.players[1].wizard.blackDamage = 3; noJinx.players[1].wizard.damageOrder = ['black-rose', 'black-rose', 'black-rose'];
  expect(cast(noJinx, 'Crypt fever').players[0].victoryPoints).toBe(noJinx.players[0].victoryPoints);
 });

 it('Black feather moves the caster, steals from a jinxed target and places it in a yellow or blue room', () => {
  const s = fixture(); s.players[1].jinxes = [jinx('OBLIVION')]; s.players[1].victoryPoints = 2;
  const far = s.board.rooms.find(r => !r.startingFor && r.color && !['amber', 'azure'].includes(r.color))!;
  s.players[1].wizard.position = { ...far.tiles[0] };
  const after = cast(s, 'Black feather');
  const room = (id: string) => after.board.rooms.find(r => r.tiles.some(h => h.q === after.players.find(p => p.id === id)!.wizard.position.q && h.r === after.players.find(p => p.id === id)!.wizard.position.r))!;
  expect(room('p1').id).toBe(far.id);
  expect(after.players[1].victoryPoints).toBe(1);
  expect(['amber', 'azure']).toContain(room('p2').color);
 });
});
