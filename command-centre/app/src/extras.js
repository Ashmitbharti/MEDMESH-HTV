// MedMesh patient extras: offline first-aid guides, nearby places, CPR metronome.
// First-aid content is general public guidance (Red Cross / Heart & Stroke style), not a substitute for training.

export const GUIDES = [
  { id: "cpr", icon: "❤️", title: "CPR (adult)", when: "Not responding and not breathing normally", steps: [
    "Check the scene is safe. Tap their shoulders and shout. No response?",
    "Shout for help. If anyone has a signal, call 911. Send someone for an AED if there is one.",
    "Place the heel of your hand on the centre of the chest, other hand on top. Arms straight.",
    "Push hard and fast: at least 5 cm deep, 100–120 times a minute. Use the beat below.",
    "Let the chest come back up fully after each push. Don't stop for more than 10 seconds.",
    "Trained in breaths? Give 30 pushes then 2 breaths. Not trained? Keep pushing (hands-only CPR).",
    "When an AED arrives, turn it on and follow its voice instructions.",
    "Keep going until help takes over or the person starts breathing normally.",
  ], cpr: true },
  { id: "bleed", icon: "🩸", title: "Severe bleeding", when: "Blood spurting or soaking through", steps: [
    "Put on gloves or use a plastic bag if you can.",
    "Press firmly and directly on the wound with a clean cloth or your hand.",
    "Keep pressing: don't lift to check. If blood soaks through, add more cloth on top.",
    "If bleeding from an arm or leg won't stop and you're trained, apply a tourniquet 5–8 cm above the wound.",
    "Keep the person lying down and warm. Watch for pale, cold, sweaty skin (shock).",
  ] },
  { id: "choke", icon: "🫁", title: "Choking (adult/child)", when: "Can't speak, cough or breathe", steps: [
    "Ask: \"Are you choking?\" If they can cough forcefully, encourage coughing.",
    "If they can't breathe, speak or cough: stand behind them, lean them forward.",
    "Give 5 firm back blows between the shoulder blades with the heel of your hand.",
    "Then 5 abdominal thrusts: fist just above the belly button, pull sharply in and up.",
    "Repeat 5 back blows and 5 thrusts until the object comes out.",
    "If they become unresponsive, lower them to the ground and start CPR.",
  ] },
  { id: "burn", icon: "🔥", title: "Burns", when: "Heat, chemical or electrical burns", steps: [
    "Make sure the source is off (electrical: don't touch them until power is off).",
    "Cool the burn under cool running water for at least 20 minutes. No ice.",
    "Remove rings, watches and tight clothing near the burn before swelling starts.",
    "Don't break blisters. Don't put butter, oil or creams on it.",
    "Cover loosely with clean plastic wrap or a clean non-fluffy cloth.",
    "Large burns, or burns to the face, hands, genitals or airway, need urgent care: send an SOS.",
  ] },
  { id: "seizure", icon: "⚡", title: "Seizure", when: "Shaking, stiffening or not responding", steps: [
    "Stay calm and time the seizure.",
    "Move hard objects away. Cushion their head.",
    "Don't hold them down. Don't put anything in their mouth.",
    "When the shaking stops, roll them onto their side (recovery position).",
    "Send an SOS if it lasts more than 5 minutes, they don't wake up, they're injured, pregnant, or it's their first seizure.",
  ] },
  { id: "allergy", icon: "💉", title: "Severe allergic reaction", when: "Swelling, trouble breathing, hives after a trigger", steps: [
    "If they have an epinephrine auto-injector (EpiPen), help them use it in the outer thigh. Through clothing is OK.",
    "Send an SOS right away, even if they feel better.",
    "Lie them down with legs raised. If breathing is hard, let them sit up.",
    "If there's no improvement after 5 minutes and they have a second injector, give a second dose.",
    "If they stop breathing normally, start CPR.",
  ] },
  { id: "fracture", icon: "🦴", title: "Broken bone / fall", when: "Pain, swelling, deformed limb", steps: [
    "Don't move the person if you suspect a head, neck or back injury, unless they're in danger.",
    "Keep the injured limb still in the position you found it.",
    "Support it with padding (rolled clothes, pillows). Don't try to straighten it.",
    "Apply something cold wrapped in cloth for 20 minutes to reduce swelling.",
    "Watch for shock: pale, cold, sweaty, confused.",
  ] },
  { id: "cold", icon: "🥶", title: "Hypothermia (cold & wet)", when: "Shivering, confusion, after flood water", steps: [
    "Move them somewhere dry and out of the wind.",
    "Gently remove wet clothes. Wrap in dry blankets, covering the head.",
    "Warm the core first (chest, armpits, groin). No hot water, no rubbing the limbs.",
    "If awake and able to swallow, give warm, sweet drinks. No alcohol.",
    "Severe shivering stops, confusion, drowsiness: send an SOS.",
  ] },
  { id: "recovery", icon: "🛌", title: "Recovery position", when: "Breathing but not responding", steps: [
    "Kneel beside them. Place the arm nearest you at a right angle.",
    "Bring the far arm across the chest, back of the hand against their near cheek.",
    "Bend the far knee up, then pull on that knee to roll them toward you onto their side.",
    "Tilt the head back slightly to keep the airway open.",
    "Check breathing every minute until help arrives.",
  ] },
];

export const PLACES = [
  { kind: "hospital", id: "SGH", name: "Scarborough General", ll: [43.7556, -79.2462], note: "ER · cardiac · trauma" },
  { kind: "hospital", id: "CEN", name: "Centenary Hospital", ll: [43.7783, -79.2053], note: "ER · cardiac · trauma · obstetrics · paeds" },
  { kind: "hospital", id: "BIR", name: "Birchmount Hospital", ll: [43.8039, -79.3005], note: "ER · trauma" },
  { kind: "hospital", id: "UFC", name: "UTSC Field Clinic", ll: [43.7839, -79.1874], note: "Minor injuries only" },
  { kind: "pharmacy", id: "MSP", name: "Morningside Pharmacy", ll: [43.7900, -79.2050], note: "Pharmacy" },
  { kind: "pharmacy", id: "ECP", name: "Ellesmere Community Rx", ll: [43.7765, -79.2430], note: "Pharmacy" },
  { kind: "pharmacy", id: "MVR", name: "Malvern Rx", ll: [43.8080, -79.2240], note: "Pharmacy" },
  { kind: "shelter", id: "SHA", name: "Shelter A · UTSC Athletics", ll: [43.7839, -79.1874], note: "Warming centre · cots · MedMesh node" },
  { kind: "shelter", id: "SHB", name: "Shelter B · Malvern Community Centre", ll: [43.8060, -79.2200], note: "Food · water · charging · MedMesh node" },
  { kind: "shelter", id: "SHC", name: "School gym · Lawrence Ave", ll: [43.7640, -79.2300], note: "Overnight shelter" },
];

export function distM(a, b) {
  const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// CPR metronome: 110 beats/min with sound + vibration, counts compressions in sets of 30
export class Metronome {
  constructor(onBeat) { this.onBeat = onBeat; this.timer = null; this.count = 0; }
  start() {
    if (this.timer) return;
    try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    this.count = 0;
    this.timer = setInterval(() => {
      this.count++;
      if (this.ctx) { const o = this.ctx.createOscillator(), g = this.ctx.createGain(); o.frequency.value = this.count % 30 === 0 ? 1320 : 880; g.gain.value = 0.25; o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + 0.06); }
      if (navigator.vibrate) navigator.vibrate(40);
      this.onBeat(this.count);
    }, 60000 / 110);
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  get running() { return !!this.timer; }
}
