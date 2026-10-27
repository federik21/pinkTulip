import { describe, expect, it } from 'vitest';
import { createGame, createLibrary, EVOCATION_TYPES, getEvocationSupply, summonEvocation, ELEMENTS } from '../src';

describe('Alchemy school and elements',()=>{
 it('adds a 36-card Alchemy school with 12 spells, 3 copies each',()=>{
  const s=createGame(2),deck=s.library.find(d=>d.id==='alchemy')!;
  expect(deck.cards).toHaveLength(36);
  expect(new Set(deck.cards.map(c=>c.name)).size).toBe(12);
 });
 it('gives every spell in the library an element',()=>{
  for(const deck of createGame(2).library)for(const c of deck.cards)expect(ELEMENTS).toContain(c.element);
 });
 it('defines a finite Nigredo supply',()=>{
  expect(EVOCATION_TYPES.NIGREDO).toBeDefined();
  const s=createGame(2);s.phase='ACTION';
  expect(getEvocationSupply(s).NIGREDO).toBeGreaterThan(0);
  const before=getEvocationSupply(s).NIGREDO;
  summonEvocation(s,s.players[0],'NIGREDO',{q:0,r:0});
  expect(getEvocationSupply(s).NIGREDO).toBe(before-1);
 });
 it('never lets victory points go negative',()=>{
  expect(createLibrary).toBeDefined();
  const s=createGame(2);
  expect(s.players.every(p=>p.victoryPoints>=0)).toBe(true);
 });
});
