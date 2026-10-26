import { describe, expect, it } from 'vitest';
import { applyAction, createGame, moment } from '../src';
import type { ActiveSpell, Card, GameState, PendingDecision } from '../src';

function fixture():GameState {
 const s=createGame(3);s.phase='ACTION';s.round=1;s.currentPlayerId='p1';s.firstPlayerId='p1';
 s.activation={playerId:'p1',actionsUsed:0,exploring:0,sequencedSpellUsed:false,spellsCast:0,discardedExit:false,roomEffectUsed:false};
 s.turnRecapDraft={playerId:'p1',logStart:s.log.length,cards:[]};
 for(const p of s.players){p.connected=true;p.wizard.position={q:0,r:0};}
 s.players[0].isBot=true;
 return s;
}
const strike:Card={id:'attack',name:'Two Bolts',kind:'SPELL',target:'MAGE',range:2,moments:[moment.damage(1),moment.damage(1)]};
const ward:Card={id:'ward',name:'Mending Ward',kind:'SPELL',spellType:'PROTECTION',target:'SELF',range:0,moments:[moment.heal(1)],trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}};

describe('turn recap',()=>{
 it('records the ordered public log with the cast and triggered cards, then closes at end of turn',()=>{
  const s=fixture();s.players[0].prepared.rapid={card:strike,used:false};
  const hidden:ActiveSpell={id:'ward',playerId:'p2',card:ward};s.readiedSpells!.push(hidden);s.activeSpellOrder!.push(hidden.id);
  let state=applyAction(s,{type:'CAST_SPELL',playerId:'p1',slot:'rapid',targetPlayerId:'p2'});
  const decision=()=>state.pendingDecision as Extract<PendingDecision,{kind:'REACTIVE_SPELL'}>;
  state=applyAction(state,{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:decision().key,activeSpellId:'ward',targetId:'p2'});
  expect(state.pendingDecision).toBeUndefined();
  expect(state.turnRecaps ?? []).toHaveLength(0);
  state=applyAction(state,{type:'END_ACTIVATION',playerId:'p1'});
  const [recap]=state.turnRecaps!;
  expect(state.turnRecapDraft?.playerId).not.toBe('p1');
  expect(recap).toMatchObject({playerId:'p1',isBot:true,round:1});
  expect(recap.lines.at(-1)).toMatch(/ends their turn/);
  const cast=recap.cards.find(c=>c.role==='CAST')!,triggered=recap.cards.find(c=>c.role==='TRIGGERED')!;
  expect(cast.card).toMatchObject({name:'Two Bolts'});
  expect(triggered).toMatchObject({ownerId:'p2',trigger:'DAMAGE_TAKEN'});
  expect(triggered.card.name).toBe('Mending Ward');
  // Cards are anchored after the log line that announced them, in the actual order.
  expect(recap.lines[cast.at-1]).toMatch(/casts Two Bolts/);
  expect(recap.lines[triggered.at-1]).toMatch(/reveals Mending Ward/);
  expect(cast.at).toBeLessThan(triggered.at);
 });
 it('never records a face-down Trap or Protection until it is revealed',()=>{
  const s=fixture();s.players[0].prepared.rapid={card:ward,used:false};
  const state=applyAction(applyAction(s,{type:'ACTIVATE_SPELL',playerId:'p1',slot:'rapid'}),{type:'END_ACTIVATION',playerId:'p1'});
  const [recap]=state.turnRecaps!;
  expect(recap.cards).toEqual([]);
  expect(recap.lines.join(' ')).not.toContain('Mending Ward');
 });
});
