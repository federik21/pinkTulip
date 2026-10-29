import { it } from 'vitest';
import fs from 'fs';
import { chooseBotAction } from '/Users/U114208/Downloads/black-rose-wars-online-prototype/apps/server/src/ai';
import { applyAction } from '/Users/U114208/Downloads/black-rose-wars-online-prototype/packages/game-engine/src/index';
it('repro', () => {
  const s = JSON.parse(fs.readFileSync('/Users/U114208/Downloads/black-rose-wars-online-prototype/apps/server/saves/sessions.json','utf8'));
  const g = s.rooms.find((r:any)=>r.id==='demo').game; g.players.forEach((p:any)=>p.connected=true);
  console.log('connected', g.players.map((p:any)=>[p.id,p.connected,p.isBot,p.bot]));
  console.log('chosen', JSON.stringify(chooseBotAction(structuredClone(g))), g.pendingDecision.options.length, g.players.every((p:any)=>p.connected), g.phase);
  for (const action of [{type:'RESPOND_REACTIVE_SPELL',playerId:'p2',key:g.pendingDecision.key}] as any[]) {
    try { applyAction(structuredClone(g), action); console.log('decline ok'); } catch(e:any){ console.log('decline err', e.constructor.name, e.message); }
  }
  console.log(g.log.slice(-12));
});
