import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { BadgeCheck, Bike, Building2, CircleCheck, CircleX, Clock, FlaskConical, LogOut, MapPin, Package, Store, Timer, Truck, Undo2 } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { useMesh } from '../link/meshLink';
import { useClock } from '../ui3d/project';
import LinkBanner from '../components/LinkBanner';
import { Card, Label } from '../hospital/controls';
import Beacon from './Beacon';
import { usePharmacy } from './PharmacyContext';
import { answerRequest, capOf, ITEMS, loadActs, loadStock, orders, PLACES, reply, requests, URGENCY, WINDOW_S } from './pharmacyService';

const READY_IN = [10, 20, 30, 60];
const ORDER_REPLIES = [
  { k: 'READY', label: 'Ready for pickup', icon: Package },
  { k: 'RUNNER', label: 'Sending a runner', icon: Bike },
  { k: 'PART', label: 'Only part of it', icon: Undo2 },
  { k: 'OUT', label: 'Can’t supply', icon: CircleX },
];

function Picker({ choose }) {
  return (
    <Card>
      <Label>WHICH PHARMACY IS THIS?</Label>
      {PLACES.map((p) => (
        <Pressable key={p.id} accessibilityRole="button" onPress={() => choose(p.id)} style={{ padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.line2, marginTop: 8 }}>
          <Text style={{ color: c.ink, fontSize: 15.5, fontWeight: '700' }}>{p.name}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

function Pill({ color, children, icon: I }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: color + '1f', borderWidth: 1, borderColor: color + '55' }}>
      {I ? <I size={12} color={color} /> : null}
      <Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>{children}</Text>
    </View>
  );
}

function AskCard({ r, act, onAnswer }) {
  const [mins, setMins] = useState(20);
  const u = URGENCY[r.urg] || URGENCY[3];
  const answered = act?.answer;
  const frac = r.left / WINDOW_S;
  return (
    <View style={{ marginTop: 12, padding: 15, borderRadius: 22, backgroundColor: c.panel, borderWidth: 1, borderColor: answered ? c.line : u.color + '88', transform: [{ perspective: 900 }, { rotateX: answered ? '0deg' : '3deg' }] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: u.color, fontSize: 11, fontWeight: '900', letterSpacing: 1 }}>{u.label.toUpperCase()}</Text>
          <Text style={{ color: c.ink, fontSize: 19, fontWeight: '800', marginTop: 4 }}>1 × {ITEMS[r.item] || r.item}</Text>
        </View>
        {!answered && r.phase === 'asked' ? (
          <View style={{ alignItems: 'center' }}>
            <View style={{ width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: frac > 0.33 ? c.green : c.amber, opacity: 0.35 + frac * 0.65, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: c.ink, fontSize: 14, fontWeight: '900' }}>{r.left}</Text>
            </View>
            <Text style={{ color: c.dim, fontSize: 10, marginTop: 2 }}>sec left</Text>
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <Pill color={c.sky} icon={r.travel ? Store : Truck}>{r.travel ? 'They will pick it up' : 'Responder delivers'}</Pill>
        {r.km != null ? <Pill color={c.sky} icon={MapPin}>{r.km < 1 ? `${Math.round(r.km * 1000)} m away` : `${r.km.toFixed(1)} km away`}</Pill> : null}
        {r.verified ? <Pill color={c.green} icon={BadgeCheck}>On their MedMesh ID</Pill> : null}
        {r.others ? <Pill color={c.violet}>{r.others} other place{r.others > 1 ? 's' : ''} asked too</Pill> : null}
      </View>

      {r.phase === 'won' ? (
        <View style={{ marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.45)' }}>
          <Text style={{ color: '#a7f3d0', fontSize: 12, fontWeight: '800' }}>YOU WERE CHOSEN · HOLD ONE FOR THEM</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
            <Text style={{ color: c.ink, fontSize: 34, fontWeight: '900', letterSpacing: 6, fontFamily: mono }}>{r.code}</Text>
            <Text style={{ color: c.muted, fontSize: 12.5, flex: 1 }}>{r.travel ? 'They will show this code at the counter.' : 'The responder will show this code.'} Ready in {r.minutes} min.</Text>
          </View>
          {act?.reply === 'DONE' ? (
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 10 }}><CircleCheck size={15} color={c.green} /><Text style={{ color: '#bbf7d0', fontWeight: '800' }}>Handed over</Text></View>
          ) : act?.reply === 'OUT' ? (
            <Text style={{ color: '#fde68a', fontSize: 13, marginTop: 10 }}>Released. The command centre is asking other places.</Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Pressable accessibilityRole="button" onPress={() => onAnswer('DONE')} style={{ flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.green }}>
                <Text style={{ color: '#04241a', fontSize: 14.5, fontWeight: '900' }}>Handed over</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => onAnswer('OUT')} style={{ flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>Can’t after all</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : r.phase === 'lost' ? (
        <Text style={{ color: c.muted, fontSize: 13, marginTop: 12 }}>{answered === 'OK' ? 'Another place was faster or closer. You don’t need to hold it.' : 'Handled by another place.'}</Text>
      ) : answered ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 }}>
          <Clock size={15} color={c.amber} />
          <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>{answered === 'OK' ? `You said yes, ready in ${act.minutes} min. Waiting for the command centre to pick the best place.` : 'You said you don’t have it.'}</Text>
        </View>
      ) : r.left === 0 ? (
        <Text style={{ color: c.dim, fontSize: 13, marginTop: 12 }}>Time is up: the command centre decided without your answer.</Text>
      ) : (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: c.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 8 }}>Ready in</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {READY_IN.map((m) => (
              <Pressable key={m} accessibilityRole="radio" accessibilityState={{ checked: mins === m }} accessibilityLabel={`Ready in ${m} minutes`} onPress={() => setMins(m)}
                style={{ flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: mins === m ? c.green : c.line2, backgroundColor: mins === m ? 'rgba(52,211,153,0.15)' : 'transparent' }}>
                <Text style={{ color: c.ink, fontSize: 13.5, fontWeight: '800' }}>{m < 60 ? `${m} min` : '1 h'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <Pressable accessibilityRole="button" onPress={() => onAnswer('OK', mins)} style={{ flex: 1.4, minHeight: 50, borderRadius: 16, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: c.green }}>
              <CircleCheck size={17} color="#04241a" /><Text style={{ color: '#04241a', fontSize: 15, fontWeight: '900' }}>We have it</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onAnswer('NO')} style={{ flex: 1, minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
              <Text style={{ color: c.ink, fontSize: 14.5, fontWeight: '700' }}>Don’t have it</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function OrderCard({ o, act, price, onReply }) {
  const [part, setPart] = useState(false);
  const cap = capOf(o.item);
  const chosen = act?.reply;
  return (
    <View style={{ marginTop: 12, padding: 15, borderRadius: 22, backgroundColor: c.panel, borderWidth: 1, borderColor: chosen ? c.line : 'rgba(252,165,165,0.45)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Building2 size={16} color={c.redl} />
        <Text style={{ color: c.redl, fontSize: 12, fontWeight: '800', flex: 1 }}>{o.hospital.toUpperCase()}</Text>
        <Text style={{ color: c.dim, fontSize: 11, fontFamily: mono }}>#{o.id}</Text>
      </View>
      <Text style={{ color: c.ink, fontSize: 19, fontWeight: '800', marginTop: 6 }}>{o.qty} × {ITEMS[o.item] || o.item}</Text>
      {price != null ? (
        <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 3 }}>
          At your price ${price.toFixed(2)} = ${(price * o.qty).toFixed(2)}{cap ? (price <= cap ? ` · within the $${cap.toFixed(2)} cap ✓` : ` · above the $${cap.toFixed(2)} cap (hospital accepted it, logged)`) : ''}
        </Text>
      ) : null}
      {chosen ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 12 }}>
          <CircleCheck size={15} color={c.green} />
          <Text style={{ color: '#bbf7d0', fontSize: 13.5, fontWeight: '700' }}>
            Told the hospital: {chosen.startsWith('PART:') ? `only ${chosen.slice(5)} available` : ORDER_REPLIES.find((x) => x.k === chosen)?.label.toLowerCase()}
          </Text>
        </View>
      ) : part ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Text style={{ color: c.muted, fontSize: 13, width: '100%' }}>How many can you give?</Text>
          {Array.from({ length: Math.min(o.qty - 1, 8) }, (_, i) => Math.max(1, Math.round(((i + 1) * (o.qty - 1)) / Math.min(o.qty - 1, 8)))).filter((n, i, a) => a.indexOf(n) === i).map((n) => (
            <Pressable key={n} accessibilityRole="button" accessibilityLabel={`Only ${n}`} onPress={() => onReply(`PART:${n}`)} style={{ minWidth: 48, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
              <Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}>{n}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {ORDER_REPLIES.map(({ k, label, icon: I }) => (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={label} onPress={() => (k === 'PART' ? setPart(true) : onReply(k))}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: k === 'READY' ? c.green : c.line2, backgroundColor: k === 'READY' ? 'rgba(52,211,153,0.14)' : 'transparent' }}>
              <I size={15} color={k === 'OUT' ? '#fda4af' : k === 'READY' ? c.green : c.ink} />
              <Text style={{ color: c.ink, fontSize: 13.5, fontWeight: '700' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export default function Requests() {
  const { width } = useWindowDimensions();
  const { signOut } = useAuth();
  const { pharmacy, ready, choose } = usePharmacy();
  const { link, inbox, outbox } = useMesh();
  const { now } = useClock(true, 1);
  const [acts, setActs] = useState({});
  const [stock, setStock] = useState(null);

  useEffect(() => {
    if (!pharmacy) return;
    loadActs(pharmacy.id).then(setActs);
    loadStock(pharmacy.id).then(setStock);
  }, [pharmacy, inbox.length]);

  if (!ready) return null;
  const reqs = pharmacy ? requests(inbox, pharmacy.id, now) : [];
  const ord = pharmacy ? orders(inbox) : [];
  const waiting = reqs.filter((r) => r.phase === 'asked' && !acts[r.id]?.answer && r.left > 0);
  const held = reqs.filter((r) => r.phase === 'won' && !acts[r.id]?.reply);
  const order = { asked: 0, won: 1, lost: 2 };
  const sorted = [...reqs].sort((a, b) => order[a.phase] - order[b.phase] || (!!acts[a.id]?.answer) - (!!acts[b.id]?.answer)
    || ({ N: 0, D: 1, 3: 2 }[a.urg] ?? 3) - ({ N: 0, D: 1, 3: 2 }[b.urg] ?? 3) || b.at - a.at);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(52,211,153,0.2)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(52,211,153,0.15)' }}>
            <Store size={20} color={c.green} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.green, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>{pharmacy?.kind === 'supplier' ? 'SUPPLIER ACCOUNT' : 'PHARMACY ACCOUNT'}</Text>
            <Text style={{ color: c.ink, fontSize: 17, fontWeight: '800' }} numberOfLines={1}>{pharmacy?.name || 'Pharmacy'}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open the test kit" onPress={() => router.push('/testkit')}
            style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
            <FlaskConical size={17} color={c.amber} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={async () => { await signOut(); router.replace('/welcome'); }}
            style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.line2 }}>
            <LogOut size={17} color={c.muted} />
          </Pressable>
        </View>

        {!pharmacy ? <Picker choose={choose} /> : (
          <>
            <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 16 }}>Who needs what,{'\n'}right now.</Text>
            <View style={{ marginHorizontal: -10 }}>
              <Beacon width={width - 20} waiting={waiting.length} urgent={waiting.some((r) => r.urg === 'N')} held={held.length} />
            </View>
            <LinkBanner link={link} ids={reqs.map((r) => r.id)} outbox={outbox} />

            <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 20 }}>PEOPLE NEARBY</Text>
            <Text style={{ color: c.dim, fontSize: 12, marginTop: 4, lineHeight: 17 }}>Up to 3 places are asked at once; the best answer gets it. You only see what is needed, never who asked.</Text>
            {sorted.length ? sorted.map((r) => (
              <AskCard key={r.id} r={r} act={acts[r.id]} onAnswer={async (what, mins) => {
                const next = what === 'DONE' || what === 'OUT' ? await reply(pharmacy.id, r.id, what) : await answerRequest(pharmacy.id, r.id, what === 'OK', mins);
                setActs(next);
              }} />
            )) : (
              <View style={{ marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Timer size={18} color={c.dim} /><Text style={{ color: c.muted, fontSize: 13.5, flex: 1 }}>No requests yet. They appear here the moment someone nearby asks.</Text>
              </View>
            )}

            <Text style={{ color: c.redl, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginTop: 24 }}>HOSPITAL ORDERS</Text>
            <Text style={{ color: c.dim, fontSize: 12, marginTop: 4 }}>Already price-checked and taken off your stock by the command centre.</Text>
            {ord.length ? ord.map((o) => (
              <OrderCard key={o.id} o={o} act={acts[o.id]} price={stock?.items?.[o.item]?.price ?? null}
                onReply={async (what) => setActs(await reply(pharmacy.id, o.id, what))} />
            )) : (
              <View style={{ marginTop: 12, padding: 16, borderRadius: 20, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Building2 size={18} color={c.dim} /><Text style={{ color: c.muted, fontSize: 13.5, flex: 1 }}>No hospital orders for you right now.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
