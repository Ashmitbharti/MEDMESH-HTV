// MedMesh first-aid scripts (English source of truth).
// Written to follow Canadian Red Cross / Heart & Stroke public first-aid guidance. MUST be reviewed by a clinician
// before a real release. Gemini never writes these: it only translates and voices them (with a numbers check).
// Every line has a stable id so a translated / voiced version can replace it one-for-one.

export const GUIDES = {
  cpr: {
    title: 'CPR', sub: 'Not breathing', tint: '#f43f5e', urgent: true,
    steps: [
      ['cpr1', 'Tap their shoulders and shout. If they do not respond and are not breathing normally, start CPR now.'],
      ['cpr2', 'Put the heel of one hand in the centre of the chest and your other hand on top. Lock your elbows.'],
      ['cpr3', 'Push hard and fast: about 5 cm deep, 100 to 120 times a minute. Follow the beat.'],
      ['cpr4', 'Let the chest come all the way back up after each push.'],
      ['cpr5', 'Do not stop until paramedics take over or the person starts breathing. If you get tired, switch with someone without pausing.'],
    ],
  },
  bleeding: {
    title: 'Severe bleeding', sub: 'Press and hold', tint: '#ef4444', urgent: true,
    steps: [
      ['bl1', 'Press firmly on the wound with a clean cloth or your hand.'],
      ['bl2', 'Keep pressing hard. Do not lift the cloth to look.'],
      ['bl3', 'If blood soaks through, put more cloth on top and keep pressing.'],
      ['bl4', 'If you can, have the person lie down and raise the injured part.'],
      ['bl5', 'Keep pressing until paramedics arrive.'],
    ],
  },
  choking: {
    title: 'Choking', sub: 'Adult or older child', tint: '#fb923c', urgent: true,
    steps: [
      ['ch1', 'If they can cough, encourage them to keep coughing.'],
      ['ch2', 'If they cannot breathe, speak or cough, stand behind them and give 5 firm blows between the shoulder blades with the heel of your hand.'],
      ['ch3', 'Then give 5 abdominal thrusts: a fist just above the belly button, pull sharply in and up.'],
      ['ch4', 'Keep repeating 5 back blows and 5 abdominal thrusts until the object comes out.'],
      ['ch5', 'If they stop responding, lower them to the ground and start CPR.'],
    ],
  },
  burns: {
    title: 'Burns', sub: 'Cool, cover', tint: '#f59e0b',
    steps: [
      ['bu1', 'Cool the burn under cool running water for at least 10 minutes, up to 20.'],
      ['bu2', 'Take off rings, watches and tight clothing near the burn, unless they are stuck to the skin.'],
      ['bu3', 'Do not use ice, butter or creams.'],
      ['bu4', 'Cover it loosely with clean plastic wrap or a clean cloth.'],
      ['bu5', 'Large burns, or burns on the face, hands or groin, need a hospital.'],
    ],
  },
  fracture: {
    title: 'Broken bone', sub: 'Keep it still', tint: '#38bdf8',
    steps: [
      ['fx1', 'Keep the injured part still, in the position you found it.'],
      ['fx2', 'Support it with rolled clothing or a pillow.'],
      ['fx3', 'Put something cold, wrapped in cloth, on it for up to 20 minutes.'],
      ['fx4', 'Do not try to straighten it.'],
      ['fx5', 'If the skin turns pale, cold and clammy, lay the person down and keep them warm.'],
    ],
  },
  recovery: {
    title: 'Recovery position', sub: 'Breathing, not responding', tint: '#34d399',
    steps: [
      ['rp1', 'If they are breathing but do not respond, roll them onto their side.'],
      ['rp2', 'Bend the top leg so the knee rests on the ground. This stops them rolling over.'],
      ['rp3', 'Tilt the head back slightly to keep the airway open.'],
      ['rp4', 'Check their breathing every minute. If it stops, start CPR.'],
    ],
  },
  hypothermia: {
    title: 'Too cold', sub: 'Hypothermia', tint: '#93c5fd',
    steps: [
      ['hy1', 'Move the person somewhere warm and dry, out of the wind.'],
      ['hy2', 'Gently remove wet clothes and wrap them in blankets, covering the head.'],
      ['hy3', 'Warm the centre of the body first: chest, neck and head.'],
      ['hy4', 'If they are awake and can swallow, give a warm sweet drink. No alcohol.'],
      ['hy5', 'Handle them gently. Do not rub their arms or legs.'],
    ],
  },
  drowning: {
    title: 'Pulled from water', sub: 'Near-drowning', tint: '#22d3ee',
    steps: [
      ['dr1', 'Only go into the water if it is safe. Reach out or throw something that floats.'],
      ['dr2', 'Once they are out, check their breathing. If they are not breathing normally, start CPR.'],
      ['dr3', 'If they are breathing, put them on their side in the recovery position.'],
      ['dr4', 'Keep them warm, and get them checked even if they seem fine.'],
    ],
  },
  lowsugar: {
    title: 'Low blood sugar', sub: 'Diabetes', tint: '#a78bfa', personal: true,
    steps: [
      ['ls1', 'Signs: shaky, sweaty, confused, pale or acting strangely.'],
      ['ls2', 'If they are awake and can swallow, give 15 grams of fast sugar: juice, regular pop or 4 glucose tablets.'],
      ['ls3', 'Wait 15 minutes. If they still feel unwell, give the same again.'],
      ['ls4', 'If they are unconscious, give nothing by mouth. Put them on their side and send an SOS.'],
    ],
  },
  oxygen: {
    title: 'Oxygen or power runs out', sub: 'Home oxygen / CPAP', tint: '#60a5fa', personal: true,
    steps: [
      ['ox1', 'Switch to your backup oxygen cylinder now.'],
      ['ox2', 'Sit upright, stay calm and breathe slowly.'],
      ['ox3', 'Keep oxygen away from flames, candles and heaters.'],
      ['ox4', 'If your lips turn blue, you feel confused or very short of breath, send an SOS right away.'],
    ],
  },
};

// Spoken during CPR, between beats
export const CPR_COACH = [
  ['cc1', 'Push hard and fast.'],
  ['cc2', 'Keep going. Help is coming.'],
  ['cc3', 'Let the chest come all the way back up.'],
  ['cc4', 'You are doing well. Keep pushing.'],
  ['cc5', 'If you are tired, switch with someone now, without stopping.'],
];

// Personal lines, chosen by fixed rules from the MedMesh ID (never written by AI)
export const TIPS = {
  thinner: ['tp1', 'bleeding', 'You take a blood thinner, so bleeding takes longer to stop. Keep pressing for at least 10 minutes without letting go.'],
  heart: ['tp2', 'cpr', 'You have a heart condition. Make sure the people you live with know how to do CPR.'],
  oxygen: ['tp3', 'oxygen', 'Keep a full backup cylinder ready, and tell the command centre you use home oxygen.'],
  diabetes: ['tp4', 'lowsugar', 'Keep fast sugar with you at all times, like juice or glucose tablets.'],
  allergy: ['tp5', 'choking', 'If you have an EpiPen, keep it with you and tell people where it is.'],
};

export const LANGUAGES = [
  ['English', 'en', 'English'], ['Français', 'fr', 'French'], ['Español', 'es', 'Spanish'], ['ਪੰਜਾਬੀ Punjabi', 'pa', 'Punjabi'],
  ['हिन्दी Hindi', 'hi', 'Hindi'], ['தமிழ் Tamil', 'ta', 'Tamil'], ['اردو Urdu', 'ur', 'Urdu'], ['中文 Mandarin', 'zh', 'Mandarin Chinese'],
  ['Tagalog', 'tl', 'Tagalog'], ['Português', 'pt', 'Portuguese'], ['العربية Arabic', 'ar', 'Arabic'], ['Italiano', 'it', 'Italian'],
];
const lang = (label) => LANGUAGES.find(([l]) => l === label) || LANGUAGES[0];
export const langCode = (label) => lang(label)[1];
export const langName = (label) => lang(label)[2];

// Which guides and tips this person gets, from their MedMesh ID (fixed rules)
export function personalise(details = {}) {
  const t = [details.conditions, details.medications, details.devices, details.allergies].join(' ').toLowerCase();
  const guides = ['cpr', 'bleeding', 'choking', 'burns', 'fracture', 'recovery', 'hypothermia', 'drowning'];
  const tips = [];
  if (/apixaban|warfarin|rivaroxaban|dabigatran|edoxaban|heparin|eliquis|xarelto|coumadin|clopidogrel|blood thinner|anticoagul/.test(t)) tips.push('thinner');
  if (/heart/.test(t)) tips.push('heart');
  if (/diabet|insulin|metformin/.test(t)) { guides.push('lowsugar'); tips.push('diabetes'); }
  if (/oxygen|cpap|bipap/.test(t)) { guides.push('oxygen'); tips.push('oxygen'); }
  if (/epipen|anaphyla|peanut|shellfish|bee/.test(t)) tips.push('allergy');
  return { guides, tips };
}

// What to suggest first: the active hazard and the person's own conditions
export function recommended(details = {}, hazard = 'calm') {
  const { guides } = personalise(details);
  const byHazard = { snow: ['hypothermia'], flood: ['drowning', 'hypothermia'], fire: ['burns'], storm: ['fracture', 'bleeding'], quake: ['fracture', 'bleeding'], rain: ['drowning'] };
  const out = [...(byHazard[hazard] || []), ...guides.filter((g) => GUIDES[g].personal), 'cpr', 'bleeding'];
  return [...new Set(out)].slice(0, 4);
}

// Every English line in this person's pack, and which ones get a Gemini voice (the life-saving ones)
export function packLines(details) {
  const { guides, tips } = personalise(details);
  const items = [];
  guides.forEach((g) => { items.push({ id: `t_${g}`, text: GUIDES[g].title }); GUIDES[g].steps.forEach(([id, text]) => items.push({ id, text })); });
  CPR_COACH.forEach(([id, text]) => items.push({ id, text }));
  tips.forEach((k) => items.push({ id: TIPS[k][0], text: TIPS[k][2] }));
  const voice = items.filter((i) => /^(cpr|cc|bl|ch|tp|ls|ox)\d/.test(i.id)).map((i) => i.id);
  return { items, voice, guides, tips };
}
