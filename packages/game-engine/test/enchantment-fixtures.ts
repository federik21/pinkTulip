import { moment } from '../src/cards';
import type { Card } from '../src';

// Test-only reactive/ongoing cards. The live game ships the Agony school alone;
// these fixtures keep coverage for Protection, Contingency and every trigger event.
export function createEnchantmentFixtures(): Card[] {
 const patterns: Omit<Card, 'id' | 'kind' | 'schoolId'>[] = [
  { name:'Threshold Snare', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  triggerText:'When an enemy enters a room within range 2',
  rulesText:'When an enemy enters a room within range 2, reveal and deal 2 damage to that model.',
   trigger:{event:'ENTER_ROOM',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_MODEL'}] },
  { name:'Spell Leech', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  triggerText:'When an enemy casts in a room within range 2',
  rulesText:'When an enemy casts in a room within range 2, reveal and deal 2 damage to that caster before its printed effects resolve.',
   trigger:{event:'SPELL_CAST',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'DAMAGE',amount:2,target:'EVENT_ACTOR'}] },
  { name:'Thorn Retort', spellType:'PROTECTION', target:'SELF', moments: [], range:0,
  triggerText:'When damage is dealt to you',
  rulesText:'When damage is dealt to you, reveal and heal 1 wound before dealing 1 damage back to the attacker.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ENEMY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'},{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}] },
  { name:'Mending Ward', spellType:'PROTECTION', target:'MAGE', moments: [], range:2,
  triggerText:'When a mage within range 2 takes damage',
  rulesText:'When a mage within range 2 takes damage, reveal and heal that mage 2 wounds. Defeated models cannot be healed.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:2,target:'BOUND_MODEL'}] },
  { name:"Servant's Safeguard", spellType:'PROTECTION', target:'EVOCATION', moments: [], range:3,
  triggerText:'When an evocation within range 3 takes damage',
  rulesText:'When an evocation within range 3 takes damage, reveal and heal it 2 wounds. Destroyed models cannot be healed.',
   trigger:{event:'DAMAGE_TAKEN',relation:'ANY',scope:'BOUND_MODEL'}, triggerEffects:[{effect:'HEAL',amount:2,target:'BOUND_MODEL'}] },
  { name:'Hearth Ward', spellType:'PROTECTION', target:'ROOM', moments: [], range:2,
  triggerText:'When an enemy activates a room within range 2',
  rulesText:'When an enemy activates a room within range 2, reveal and heal your mage 2 wounds before the room reward.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'BOUND_ROOM'}, triggerEffects:[{effect:'HEAL',amount:2,target:'OWNER'}] },
  { name:'Tripwire', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  triggerText:'When an enemy evocation activates in a room within range 2 or in a room of the same color',
  rulesText:'When an enemy evocation activates in a room within range 2 or in a room of the same color, reveal and deal 1 damage to it.',
   trigger:{event:'EVOCATION_ACTIVATED',relation:'ENEMY',scope:'BOUND_COLOR'}, triggerEffects:[{effect:'DAMAGE',amount:1,target:'EVENT_MODEL'}] },
  { name:'Cinder Seal', spellType:'TRAP', target:'ROOM', moments: [], range:2,
  triggerText:'When an enemy activates a room within range 2 or in the same color',
  rulesText:'When an enemy activates a room within range 2 or in the same color, reveal and place 2 instability in that activated room before its reward.',
   trigger:{event:'ROOM_ACTIVATED',relation:'ENEMY',scope:'BOUND_COLOR'}, triggerEffects:[{effect:'INSTABILITY',amount:2,target:'EVENT_ROOM'}] },
  { name:"Pilgrim's Mark", spellType:'CONTINGENCY', target:'SELF', moments: [], range:0,
   rulesText:'When you enter a different room, convert the live instability there to your color.',
   ongoing:{trigger:{event:'ENTER_ROOM',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'CONVERT',amount:1,target:'EVENT_ROOM'}]} },
  { name:'Thorned Path', spellType:'COMBAT', target:'MAGE', moments: [moment.convert(1)], range:2,
   rulesText:'When a mage within range 2 enters a different room, place 1 instability there in your color.',
   ongoing:{trigger:{event:'ENTER_ROOM',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'INSTABILITY',amount:1,target:'EVENT_ROOM'}]} },
  { name:'Runic Remedy', spellType:'CONTINGENCY', target:'MAGE', moments: [moment.heal(1)], range:2,
   rulesText:'When a mage within range 2 activates a room, heal it before the reward.',
   ongoing:{trigger:{event:'ROOM_ACTIVATED',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'HEAL',amount:1,target:'BOUND_MODEL'}]} },
  { name:'Arcane Feedback', spellType:'COMBAT', target:'MAGE', moments: [moment.damage(1)], range:2,
   rulesText:'Target an enemy mage within range 2, then remain bound. Whenever it casts, it suffers further harm before the printed effects.',
   ongoing:{trigger:{event:'SPELL_CAST',relation:'ANY',scope:'BOUND_MODEL'},effects:[{effect:'DAMAGE',amount:1,target:'EVENT_ACTOR'}]} },
 ];
 return Array.from({length:36},(_,i)=>({...patterns[i%patterns.length],id:`enchantment-${i+1}`,kind:'SPELL',schoolId:'enchantment'}));
}
