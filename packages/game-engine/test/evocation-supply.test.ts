import { describe, expect, it } from 'vitest';
import { applyAction, createAgonyDeck, createGame, EVOCATION_MODEL_LIMITS, evocationAttack, getEvocationSupply, moment, summonEvocation } from '../src';
import type { GameState } from '../src';

const origin={q:0,r:0};
function fixture():GameState {
 const s=createGame(4);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 for(const p of s.players)p.wizard.position={...origin};
 return s;
}

describe('shared evocation model supplies',()=>{
 it('starts with three Succubi and six Cadavers for the entire game',()=>{
  expect(EVOCATION_MODEL_LIMITS).toEqual({SUCCUBUS:3,CADAVER:6,COLOSSUS:3});
  expect(getEvocationSupply(fixture())).toEqual({SUCCUBUS:3,CADAVER:6,COLOSSUS:3});
 });
 it.each(['SUCCUBUS','CADAVER'] as const)('enforces the global %s supply across different owners',kind=>{
  const s=fixture(),limit=EVOCATION_MODEL_LIMITS[kind];
  for(let i=0;i<limit;i++)expect(summonEvocation(s,s.players[1+Math.floor(i/3)],kind,origin)).toBeDefined();
  const before=structuredClone(s.evocations);
  expect(getEvocationSupply(s)[kind]).toBe(0);
  expect(summonEvocation(s,s.players[0],kind,origin)).toBeUndefined();
  expect(s.evocations).toEqual(before);
  expect(s.log.at(-1)).toMatch(/shared supply/);
 });
 it('keeps the per-mage three-model cap separate from both shared supplies',()=>{
  const s=fixture(),p=s.players[0];
  summonEvocation(s,p,'CADAVER',origin);summonEvocation(s,p,'SUCCUBUS',origin);summonEvocation(s,p,'CADAVER',origin);
  expect(getEvocationSupply(s)).toEqual({SUCCUBUS:2,CADAVER:4,COLOSSUS:3});
  expect(summonEvocation(s,p,'SUCCUBUS',origin)).toBeUndefined();
  expect(summonEvocation(s,p,'CADAVER',origin)).toBeUndefined();
  expect(getEvocationSupply(s)).toEqual({SUCCUBUS:2,CADAVER:4,COLOSSUS:3});
  expect(summonEvocation(s,s.players[1],'SUCCUBUS',origin)).toBeDefined();
 });
 it.each(['SUCCUBUS','CADAVER'] as const)('returns a destroyed %s to supply for another mage',kind=>{
  const s=fixture(),limit=EVOCATION_MODEL_LIMITS[kind];
  for(let i=0;i<limit;i++)summonEvocation(s,s.players[1+Math.floor(i/3)],kind,origin);
  const victim=s.evocations[0];
  s.players[0].prepared.rapid={used:false,card:{id:'destroy',name:'Destroy servant',kind:'SPELL',target:'EVOCATION',range:0,moments:[moment.damage(victim.health)]}};
  const before=structuredClone(s);
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetEvocationId:victim.id});
  expect(s).toEqual(before);
  expect(getEvocationSupply(result)[kind]).toBe(1);
  expect(getEvocationSupply(s)[kind]).toBe(0); // Undo/old snapshots retain their own inventory.
  expect(result.players[0].cubes.onEvocations).toBe(0);
  expect(result.players[0].cubes.available).toBe(s.players[0].cubes.available);
  expect(summonEvocation(result,result.players[3],kind,origin)).toMatchObject({playerId:'p4',kind});
  expect(getEvocationSupply(result)[kind]).toBe(0);
 });
 it('honors legacy model snapshots with no kind field and clamps malformed over-cap counts at zero',()=>{
  const s=fixture();
  const e=summonEvocation(s,s.players[0],'SUCCUBUS',origin)!;delete e.kind;
  e.name='Renamed servant';
  expect(getEvocationSupply(s)).toEqual({SUCCUBUS:2,CADAVER:6,COLOSSUS:3});
  s.evocations=Array.from({length:4},(_,i)=>({...e,id:`legacy-${i}`}));
  expect(getEvocationSupply(s).SUCCUBUS).toBe(0);
 });
 it('lets Cross and Delight finish Pain but never activates an old model when all Succubi are in play',()=>{
  const s=fixture();
  for(const p of s.players.slice(1))summonEvocation(s,p,'SUCCUBUS',origin);
  const card=createAgonyDeck('test').find(c=>c.name==='Cross and Delight')!;
  s.players[0].prepared.rapid={card,used:false};
  const result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:'room-0,0'});
  expect(result.evocations).toHaveLength(3);
  expect(result.evocationActivation).toBeNull();
  expect(result.players[0].wizard.blackDamage).toBe(1);
  expect(result.activation?.actionsUsed).toBe(1);
  expect(getEvocationSupply(result).SUCCUBUS).toBe(0);
 });
 it.each([0,1])('summons only the %i remaining Cadavers from a double-reward Grey room',remaining=>{
  let s=fixture();
  for(let i=0;i<6-remaining;i++)summonEvocation(s,s.players[1+Math.floor(i/3)],'CADAVER',origin);
  const grey=s.board.rooms.find(r=>r.color==='grey')!;grey.reconstructed=true;grey.scored=true;
  s.players[0].wizard.position={...grey.tiles[0]};
  const tokens=s.players[0].actionTokens;
  s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  s=applyAction(s,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(s.evocations.filter(e=>e.playerId==='p1')).toHaveLength(remaining);
  expect(s.evocations).toHaveLength(6);
  expect(getEvocationSupply(s).CADAVER).toBe(0);
  expect(s.log.filter(line=>line.includes('summons a Cadaver from the Grey room'))).toHaveLength(remaining);
  expect(s.board.rooms.find(r=>r.id===grey.id)!.specialUsed).toBe(true);
  expect(s.activation?.roomEffectUsed).toBe(true);
  expect(s.activation?.actionsUsed).toBe(1);
  expect(s.players[0].actionTokens).toBe(tokens-1);
 });
});

describe('blank Cadaver effect',()=>{
 it('keeps its base stats without a passive or triggered ability, even when wounded',()=>{
  const s=fixture(),cadaver=summonEvocation(s,s.players[0],'CADAVER',origin)!;
  expect(cadaver).toMatchObject({kind:'CADAVER',movement:2,attack:2,health:2});
  expect(cadaver.passive).toBeUndefined();expect(cadaver.ability).toBeUndefined();
  cadaver.damageCubes=1;expect(evocationAttack(cadaver)).toBe(2);
  cadaver.passive='WOUNDED_FURY'; // Older saved models must also have the blank effect.
  expect(evocationAttack(cadaver)).toBe(2);
 });
 it('deals only base damage through the actual wounded Cadaver activation',()=>{
  const s=fixture(),cadaver=summonEvocation(s,s.players[0],'CADAVER',origin)!;
  cadaver.damageCubes=1;
  const active=applyAction(s,{type:'ACTIVATE_EVOCATION',playerId:'p1',evocationId:cadaver.id});
  const result=applyAction(active,{type:'EVOCATION_ATTACK',playerId:'p1',targetId:'p2'});
  expect(result.players[1].wizard.damageCubes).toBe(2);
 });
 it('does not blank Succubus Wounded Fury or Soul Tithe',()=>{
  const s=fixture(),succubus=summonEvocation(s,s.players[0],'SUCCUBUS',origin)!;
  succubus.damageCubes=2;
  expect(evocationAttack(succubus)).toBe(3);
  expect(succubus.ability).toBe('SOUL_TITHE');
 });
});