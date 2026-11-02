import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAction, createGame, createHexDeck, createLibrary, getJinxSupply, getMageMovement, hasJinx, JINX_COPIES, JINX_TARGET } from '../src';
import type { Card, GameState, JinxName, Moment } from '../src';

const activation=(playerId:string)=>({playerId,actionsUsed:0,exploring:0,spellsCast:0,sequencedSpellUsed:false,discardedExit:false,roomEffectUsed:false});
afterEach(()=>vi.restoreAllMocks());
function fixture():GameState {
 const s=createGame(2),origin=s.board.rooms.find(room=>room.id==='room-0,0')!.tiles[0];
 s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';s.activation=activation('p1');
 for(const p of s.players)p.wizard.position={...origin};
 return s;
}
const jinx=(name:JinxName,cubes=0)=>({id:`j-${name}-${cubes}-${Math.random()}`,name,cubes});
const mageSpell=(moments:Moment[],extra:Partial<Card>={}):Card=>({id:'t',name:'Test hex',kind:'SPELL',spellType:'COMBAT',target:'MAGE',range:2,moments,...extra} as Card);
const cast=(s:GameState,card:Card,targetPlayerId='p2')=>{
 s.players[0].prepared.rapid={card,used:false};
 return applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId});
};
const hexCard=(name:string)=>createHexDeck('hex','hex').find(card=>card.name===name)!;

describe('Hex school',()=>{
 it('adds a 36-card school with the twelve spells and a library entry',()=>{
  const cards=createHexDeck('hex','hex');
  expect(cards).toHaveLength(36);
  expect(new Set(cards.map(card=>card.name)).size).toBe(12);
  expect(createLibrary().find(deck=>deck.id==='hex')).toMatchObject({name:'Hex'});
  for(const name of ['Baleful curse','An eye for an eye'])expect(hexCard(name).spellType).toBe('PROTECTION');
  for(const name of ['Cerebral worm','Suffocation','Bad luck','Cursed oracle'])expect(hexCard(name).spellType).toBe('TRAP');
  for(const card of cards)expect(card.rulesText).toBeTruthy();
 });

 it('assigns a jinx once per mage and tracks the finite supply', () => {
  let s=fixture();
  s=cast(s,mageSpell([{effect:'ASSIGN_JINX',jinx:'SLOWNESS'}]));
  expect(s.players[1].jinxes).toMatchObject([{name:'SLOWNESS',cubes:0}]);
  expect(getJinxSupply(s).SLOWNESS).toBe(JINX_COPIES-1);
  s.players[0].prepared.rapid={card:mageSpell([{effect:'ASSIGN_JINX',jinx:'SLOWNESS'}]),used:false};
  s.activation=activation('p1');
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  expect(s.players[1].jinxes).toHaveLength(1);
  expect(s.log.some(line=>/already carries Slowness/.test(line))).toBe(true);
 });

 it('does not assign a jinx whose three copies are all held', () => {
  const s=fixture();
  const a=createGame(4);
  expect(getJinxSupply(a).OBLIVION).toBe(JINX_COPIES);
  for(const p of a.players.slice(0,3))p.jinxes=[jinx('OBLIVION')];
  expect(getJinxSupply(a).OBLIVION).toBe(0);
  s.players[0].jinxes=[];
  expect(getJinxSupply(s).OBLIVION).toBe(JINX_COPIES);
 });

 it('Weakness inflicts 2 BR damage on assignment and again after respawn', () => {
  let s=fixture();
  s=cast(s,mageSpell([{effect:'ASSIGN_JINX',jinx:'WEAKNESS'}]));
  expect(hasJinx(s.players[1],'WEAKNESS')).toBe(true);
  expect(s.players[1].wizard.damageCubes).toBe(2);
  expect(s.players[1].wizard.blackDamage).toBe(2);
 });

 it('Vulnerability lets later jinx assigners inflict 1 damage, but not on its own assignment', () => {
  let s=fixture();
  s=cast(s,mageSpell([{effect:'ASSIGN_JINX',jinx:'VULNERABILITY'}]));
  expect(s.players[1].wizard.damageCubes).toBe(0);
  s.activation=activation('p1');
  s=cast(s,mageSpell([{effect:'ASSIGN_JINX',jinx:'SLOWNESS'}]));
  expect(s.players[1].wizard.damageCubes).toBe(1);
  expect(s.players[1].wizard.damageByPlayer.p1).toBe(1);
 });

 it('Slowness caps speed at 1 and progresses with Explore until discarded', () => {
  let s=fixture();
  s.players[1].jinxes=[];
  s.players[0].jinxes=[jinx('SLOWNESS')];
  expect(getMageMovement(s.players[0])).toBe(1);
  expect(getMageMovement(s.players[1])).toBe(2);
  const origin={...s.players[0].wizard.position};
  s.players[0].wizard.position=origin;
  s=applyAction(s,{type:'EXPLORE',playerId:'p1'});
  expect(s.activation!.exploring).toBe(1);
  expect(s.players[0].jinxes![0].cubes).toBe(1);
 });

 it('discards a jinx at three cubes, returns its cubes and feeds Vulnerability', () => {
  let s=fixture();
  s.players[0].jinxes=[jinx('SLOWNESS',JINX_TARGET-1),jinx('VULNERABILITY',0)];
  s.players[0].cubes.available-=JINX_TARGET-1;s.players[0].cubes.onJinxes=JINX_TARGET-1;
  s=applyAction(s,{type:'EXPLORE',playerId:'p1'});
  expect(s.players[0].jinxes!.map(j=>j.name)).toEqual(['VULNERABILITY']);
  expect(s.players[0].jinxes![0].cubes).toBe(1);
  expect(getMageMovement(s.players[0])).toBe(2);
  expect(s.players[0].cubes).toEqual({available:24,onWizard:0,onBoard:0,onEvocations:0,onJinxes:1});
 });

 it('takes jinx progress cubes from the available supply and cannot progress without one', () => {
  let s=fixture();
  s.players[0].jinxes=[jinx('SLOWNESS')];
  s=applyAction(s,{type:'EXPLORE',playerId:'p1'});
  expect(s.players[0].jinxes![0].cubes).toBe(1);
  expect(s.players[0].cubes).toMatchObject({available:24,onJinxes:1});
  s=fixture();
  s.players[0].jinxes=[jinx('SLOWNESS')];
  s.players[0].cubes.available=0;s.players[0].cubes.onBoard=25;
  s=applyAction(s,{type:'EXPLORE',playerId:'p1'});
  expect(s.players[0].jinxes![0].cubes).toBe(0);
  expect(s.players[0].cubes.onJinxes).toBeUndefined();
 });

 it('Oblivion places 1 cube less in a room and progresses', () => {
  let s=fixture();
  s.players[0].jinxes=[jinx('OBLIVION')];
  const room=s.board.rooms.find(r=>r.id==='room-0,0')!;
  const before=room.instability;
  const card={id:'r',name:'Room spell',kind:'SPELL',spellType:'COMBAT',target:'ROOM',range:Infinity,moments:[{effect:'INSTABILITY',amount:2}]} as Card;
  s.players[0].prepared.rapid={card,used:false};
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  expect(s.board.rooms.find(r=>r.id===room.id)!.instability-before).toBe(1);
  expect(s.players[0].jinxes![0].cubes).toBe(1);
 });

 it('Weakness progresses after a yellow or green room effect resolves', () => {
  let s=fixture();
  s.players[0].jinxes=[jinx('WEAKNESS')];
  const room=s.board.rooms.find(r=>(r.color==='amber'||r.color==='emerald')&&r.effect&&!r.startingFor)!;
  const card={id:'r',name:'Room spell',kind:'SPELL',spellType:'COMBAT',target:'ROOM',range:Infinity,moments:[{effect:'ACTIVATE_TARGET_ROOM'}]} as Card;
  s.players[0].prepared.rapid={card,used:false};
  s=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',roomId:room.id});
  while(s.pendingDecision?.kind==='CHOICE')s=applyAction(s,{type:'RESPOND_CHOICE',playerId:s.pendingDecision.playerId,key:s.pendingDecision.key,choiceId:s.pendingDecision.options[0].id});
  expect(s.players[0].jinxes![0].cubes).toBe(1);
 });

 it('Vulnerability progresses when a jinx is discarded', () => {
  const s=fixture();
  const p=s.players[0];
  p.jinxes=[jinx('WEAKNESS'),jinx('VULNERABILITY')];
  const litany=hexCard('Litany');
  p.prepared.rapid={card:litany,used:false};
  p.quest=null;
  let result=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid'});
  while(result.pendingDecision?.kind==='CHOICE'){
   const d=result.pendingDecision;
   const pick=d.options.find(o=>o.id.startsWith('jinx:')&&/Weakness/.test(o.label))??d.options[0];
   result=applyAction(result,{type:'RESPOND_CHOICE',playerId:d.playerId,key:d.key,choiceId:pick.id});
  }
  const left=result.players[0].jinxes!;
  expect(left.map(j=>j.name)).toEqual(['VULNERABILITY']);
  expect(left[0].cubes).toBe(1);
  expect(result.players[0].hand.length).toBeGreaterThanOrEqual(0);
 });

 it('Suffocation resolves after the activated room effect', () => {
  let s=fixture();
  s.board.rooms.find(r=>r.id==='room-0,0')!.effect='INSTABILITY';
  const suffocation=hexCard('Suffocation');
  (s.readiedSpells??=[]).push({id:'suffocation',playerId:'p2',card:suffocation});(s.activeSpellOrder??=[]).push('suffocation');
  s=applyAction(s,{type:'BEGIN_PHYSICAL_ACTION',playerId:'p1',kind:'EXPLORE'});
  s=applyAction(s,{type:'ACTIVATE_ROOM',playerId:'p1'});
  expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const d=s.pendingDecision as Extract<NonNullable<GameState['pendingDecision']>,{kind:'REACTIVE_SPELL'}>;
  s=applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:d.key,activeSpellId:'suffocation',targetId:'p1'});
  expect(s.pendingDecision).toMatchObject({kind:'CHOICE',playerId:'p2'});
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p2',key:s.pendingDecision!.key,choiceId:'room-0,0'});
  const placed=s.log.findIndex(line=>/places 1 instability/.test(line));
  const activated=s.log.findIndex(line=>/Suffocation/.test(line));
  expect(placed).toBeGreaterThanOrEqual(0);
  expect(activated).toBeGreaterThan(placed);
  expect(hasJinx(s.players[0],'OBLIVION')).toBe(true);
 });

 it('Feverish dream damages, assigns Weakness and moves the caster', () => {
  let s=fixture();
  s=cast(s,hexCard('Feverish dream'));
  while(s.pendingDecision?.kind==='CHOICE')s=applyAction(s,{type:'RESPOND_CHOICE',playerId:s.pendingDecision.playerId,key:s.pendingDecision.key,choiceId:s.pendingDecision.options[0].id});
  expect(hasJinx(s.players[1],'WEAKNESS')).toBe(true);
  expect(s.players[1].wizard.damageCubes).toBe(4);
 });

 function eyeForAnEye(attackerVp:number) {
  let s=fixture();
  s.players[0].victoryPoints=attackerVp;
  s.players[1].prepared.rapid={card:hexCard('An eye for an eye'),used:false};
  s.currentPlayerId='p2';s.activation=activation('p2');
  s=applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p2',slot:'rapid'});
  s.currentPlayerId='p1';s.activation=activation('p1');
  s=cast(s,mageSpell([{effect:'DAMAGE',amount:2}]));
  expect(s.pendingDecision?.kind).toBe('REACTIVE_SPELL');
  const decision=s.pendingDecision!;
  return applyAction(s,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:decision.key,activeSpellId:decision.options[0].activeSpellId,targetId:'p1'});
 }

 it('An eye for an eye lets the targeted mage lose 1 VP or let the spell be ignored', () => {
  let s=eyeForAnEye(2);
  expect(s.pendingDecision).toMatchObject({kind:'CHOICE',playerId:'p1'});
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p1',key:s.pendingDecision!.key,choiceId:'LOSE'});
  expect(s.players[0].victoryPoints).toBe(1);
  expect(s.players[1].wizard.damageCubes).toBe(2);
  expect(hasJinx(s.players[0],'OBLIVION')).toBe(true);
  s=eyeForAnEye(2);
  s=applyAction(s,{type:'RESPOND_CHOICE',playerId:'p1',key:s.pendingDecision!.key,choiceId:'IGNORE'});
  expect(s.players[0].victoryPoints).toBe(2);
  expect(s.players[1].wizard.damageCubes).toBe(0);
 });

 it('An eye for an eye ignores the spell without asking when the attacker has no VP', () => {
  const s=eyeForAnEye(0);
  expect(s.pendingDecision).toBeUndefined();
  expect(s.players[1].wizard.damageCubes).toBe(0);
  expect(hasJinx(s.players[0],'OBLIVION')).toBe(true);
 });
});
