import React from 'react';

export const SCHOOL_ICONS:Record<string,{name:string;glyph:string}>={
 cantrip:{name:'Cantrip',glyph:'✺'},
 transmutation:{name:'Transmutation',glyph:'⚗'},
 enchantment:{name:'Enchantment',glyph:'⌘'},
};

export function SchoolIcon({schoolId,powerful=false}:{schoolId?:string;powerful?:boolean}) {
 const school=!powerful&&schoolId&&Object.prototype.hasOwnProperty.call(SCHOOL_ICONS,schoolId)?SCHOOL_ICONS[schoolId]:undefined;
 const label=powerful?'Forgotten spells':school?`${school.name} school`:'Unaligned spell';
 return <span className="school-icon" role="img" aria-label={label} data-school-id={powerful?'forgotten':school?schoolId:'unaligned'}>{school?.glyph??'✺'}</span>;
}