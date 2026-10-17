// Crisp line icons (Lucide, ISC licence) rendered to inline SVG strings. Only the ones imported are bundled.
import {
  HeartPulse, Heart, Droplet, Wind, Flame, Zap, Syringe, Bone, Snowflake, Bed, Baby, Plus, EyeOff, Pill, Hospital,
  MapPin, Map, Navigation, ShieldCheck, TriangleAlert, Megaphone, IdCard, MessagesSquare, Radio, RadioTower, Bluetooth,
  Usb, FlaskConical, ChevronRight, ChevronLeft, Settings, User, Users, Ambulance, Package, Siren, Check, CheckCheck, X,
  Clock, Activity, Waves, House, Building2, Store, Bell, QrCode, ScanLine, WifiOff, Route, LocateFixed, Phone, Footprints,
  HandHelping, Info, OctagonAlert, Construction, TreePine, Car, Gauge, Send, RefreshCw, Play, Square, Stethoscope, Timer,
  CircleCheck, Minus, Layers, Shield, CornerUpRight, MoveUp, Flag, Brain, Thermometer,
} from "lucide";

const SET = {
  heartpulse: HeartPulse, heart: Heart, drop: Droplet, wind: Wind, flame: Flame, zap: Zap, syringe: Syringe, bone: Bone,
  snow: Snowflake, bed: Bed, baby: Baby, plus: Plus, eyeoff: EyeOff, pill: Pill, hospital: Hospital, pin: MapPin, map: Map,
  nav: Navigation, safe: ShieldCheck, warn: TriangleAlert, megaphone: Megaphone, id: IdCard, msgs: MessagesSquare,
  radio: Radio, tower: RadioTower, ble: Bluetooth, usb: Usb, flask: FlaskConical, right: ChevronRight, left: ChevronLeft,
  settings: Settings, user: User, users: Users, amb: Ambulance, box: Package, siren: Siren, check: Check, check2: CheckCheck,
  x: X, clock: Clock, pulse: Activity, waves: Waves, home: House, building: Building2, store: Store, bell: Bell, qr: QrCode,
  scan: ScanLine, offline: WifiOff, route: Route, locate: LocateFixed, phone: Phone, walk: Footprints, help: HandHelping,
  info: Info, stop: OctagonAlert, cone: Construction, tree: TreePine, car: Car, gauge: Gauge, send: Send, refresh: RefreshCw,
  play: Play, square: Square, steth: Stethoscope, timer: Timer, ok: CircleCheck, minus: Minus, layers: Layers, shield: Shield,
  turn: CornerUpRight, up: MoveUp, flag: Flag, brain: Brain, temp: Thermometer,
};

const attrs = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(" ");
const cache = {};
export function ic(name, cls = "", sw = 2) {
  const key = name + "|" + cls + "|" + sw;
  if (cache[key]) return cache[key];
  const node = SET[name] || SET.info;
  const kids = (node[2] || []).map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join("");
  return (cache[key] = `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kids}</svg>`);
}
