import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import WeatherBackdrop from '../dashboard/WeatherBackdrop';
import { useHazard } from '../dashboard/hazardService';
import { BadgePercent, CircleCheck, CircleSlash, Clock, Link2, Receipt, Send, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useMesh } from '../link/meshLink';
import { useClock } from '../ui3d/project';
import LinkBanner from '../components/LinkBanner';
import CapTowers from './CapTowers';
import { useHospital } from './HospitalContext';
import { ago, Card, Chip, Label, Stepper } from './controls';
import { ITEMS, loadPrices, PLACES, replyText, requestSupply, supplyResult } from './hospitalService';

const OK = '#34d399';
const BAD = '#f43f5e';
const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// One seller's row: a flat bar (exact value), the cap as a vertical line, the normal price as a tick.
function PriceRow({ o, base, cap, scale, w }) {
  const tint = !o.open ? c.dim : o.within ? OK : BAD;
  const I = !o.open ? CircleSlash : o.within ? CircleCheck : TriangleAlert;
  const status = !o.open ? 'Closed' : o.within ? 'Within cap' : 'Over cap · skipped';
  const bar = Math.max(4, (o.price / scale) * w);
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: c.ink, fontSize: 13.5, fontWeight: '700', flex: 1 }}>{PLACES[o.pharm] || o.name}</Text>
        <Text style={{ color: c.ink, fontSize: 13.5, fontWeight: '800' }}>{money(o.price)}</Text>
        <Text style={{ color: c.muted, fontSize: 12, width: 58, textAlign: 'right' }}>{o.pct > 0 ? '+' : ''}{o.pct.toFixed(0)}%</Text>
      </View>
      <View style={{ height: 14, marginTop: 6, width: w }}>
        <View style={{ position: 'absolute', left: 0, top: 3, height: 8, width: w, borderRadius: 4, backgroundColor: c.line }} />
        <View style={{ position: 'absolute', left: 0, top: 3, height: 8, width: bar, borderRadius: 4, backgroundColor: tint, opacity: o.open ? 1 : 0.5 }} />
        <View style={{ position: 'absolute', left: (base / scale) * w - 1, top: 0, height: 14, width: 2, backgroundColor: '#e2e8f0', opacity: 0.6 }} />
        <View style={{ position: 'absolute', left: (cap / scale) * w - 1.5, top: -2, height: 18, width: 3, borderRadius: 2, backgroundColor: OK }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 }}>
        <I size={12} color={tint} /><Text style={{ color: tint === c.dim ? c.dim : c.muted, fontSize: 11.5, fontWeight: '700' }}>{status}</Text>
      </View>
    </View>
  );
}

function Result({ req, res, item, base, onAllow }) {
  if (!res) {
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <Clock size={15} color={c.amber} />
        <Text style={{ color: c.muted, fontSize: 13 }}>{req.status === 'queued' ? 'Saved · sends when a node is in range.' : 'Asking every pharmacy and supplier at once…'}</Text>
      </View>
    );
  }
  const got = res.lines.reduce((a, l) => a + l.qty, 0);
  const fair = (base || 0) * got;
  const vsFair = fair ? (100 * (res.cost / fair - 1)) : 0;
  const worst = res.over.reduce((m, o) => Math.max(m, o.price), 0);
  const saved = worst && got ? worst * got - res.cost : 0;
  return (
    <View style={{ marginTop: 12 }}>
      {res.lines.map((l) => (
        <View key={l.pharm} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderColor: c.line }}>
          <CircleCheck size={15} color={OK} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>{PLACES[l.pharm] || l.pharm}</Text>
            {res.replies[l.pharm] ? (
              <Text style={{ color: res.replies[l.pharm] === 'OUT' || res.replies[l.pharm].startsWith('PART') ? '#fde68a' : '#a7f3d0', fontSize: 12, fontWeight: '700', marginTop: 1 }}>
                {replyText(res.replies[l.pharm])}
              </Text>
            ) : <Text style={{ color: c.dim, fontSize: 12, marginTop: 1 }}>No reply from the pharmacy yet</Text>}
          </View>
          <Text style={{ color: c.muted, fontSize: 13 }}>{l.qty} × {money(l.price)}</Text>
        </View>
      ))}
      {res.over.map((o) => (
        <View key={o.pharm} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderColor: c.line }}>
          <TriangleAlert size={15} color={BAD} />
          <Text style={{ color: c.muted, fontSize: 14, fontWeight: '700', flex: 1 }}>{PLACES[o.pharm] || o.pharm} · skipped</Text>
          <Text style={{ color: '#fda4af', fontSize: 13, fontWeight: '700' }}>{money(o.price)}{base ? ` (+${Math.round(100 * (o.price / base - 1))}%)` : ''}</Text>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <View style={{ flex: 1, padding: 12, borderRadius: 16, backgroundColor: c.panel2 }}>
          <Text style={{ color: c.muted, fontSize: 11, fontWeight: '800' }}>YOU PAY</Text>
          <Text style={{ color: c.ink, fontSize: 22, fontWeight: '900' }}>{money(res.cost)}</Text>
          <Text style={{ color: c.dim, fontSize: 11.5 }}>{got} received{fair ? ` · ${vsFair >= 0 ? '+' : ''}${vsFair.toFixed(1)}% vs normal` : ''}</Text>
        </View>
        {saved > 0 ? (
          <View style={{ flex: 1, padding: 12, borderRadius: 16, backgroundColor: 'rgba(52,211,153,0.1)', borderWidth: 1, borderColor: 'rgba(52,211,153,0.4)' }}>
            <Text style={{ color: '#a7f3d0', fontSize: 11, fontWeight: '800' }}>KEPT FROM GOUGING</Text>
            <Text style={{ color: c.ink, fontSize: 22, fontWeight: '900' }}>{money(saved)}</Text>
            <Text style={{ color: c.dim, fontSize: 11.5 }}>vs the skipped price</Text>
          </View>
        ) : null}
      </View>
      {req.allow && vsFair > 10 ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 }}>
          <TriangleAlert size={14} color={c.amber} />
          <Text style={{ color: '#fde68a', fontSize: 12.5, flex: 1, lineHeight: 17 }}>Above the cap, accepted by your hospital for a critical shortage. Recorded in the audit log.</Text>
        </View>
      ) : null}
      {res.short > 0 ? (
        <View style={{ marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: 'rgba(251,191,36,0.1)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.45)' }}>
          <Text style={{ color: '#fde68a', fontSize: 14, fontWeight: '800' }}>{res.short} still missing within the cap</Text>
          {res.over.length && !req.allow ? (
            <Pressable accessibilityRole="button" onPress={onAllow} style={{ marginTop: 8, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.amber }}>
              <Text style={{ color: '#1c1917', fontSize: 14, fontWeight: '900' }}>Critical: accept above-cap offers (logged)</Text>
            </Pressable>
          ) : <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 4 }}>Nobody nearby has more. The command centre keeps watching stock.</Text>}
        </View>
      ) : null}
    </View>
  );
}

export default function HospitalSupplies() {
  const hz = useHazard();
  const { width } = useWindowDimensions();
  const { hospital } = useHospital();
  const { link, inbox, outbox } = useMesh();
  const { now } = useClock(true, 1);
  const [prices, setPrices] = useState(null);
  const [item, setItem] = useState('INSULIN');
  const [qty, setQty] = useState(12);
  const [allow, setAllow] = useState(false);
  const [changedAt, setChangedAt] = useState(0);

  useEffect(() => { loadPrices().then(setPrices); }, [inbox.length]);

  const data = prices?.items?.[item];
  const capPct = prices?.cap_pct ?? 10;
  const scale = data ? Math.max(data.cap, ...data.offers.map((o) => o.price)) * 1.1 : 1;
  const flags = (prices?.flags || []).slice().reverse();
  const reqs = outbox.filter((o) => o.kind === 'hospital-supply').slice(-5).reverse();

  async function ask(it = item, q = qty, al = allow) {
    await requestSupply(hospital.id, it, q, al);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <WeatherBackdrop kind={hz.kind} />
      <LinearGradient colors={['rgba(52,211,153,0.18)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <Text style={{ color: OK, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>FAIR-PRICE SUPPLIES</Text>
        <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>Fast supplies.{'\n'}No disaster pricing.</Text>
        <LinkBanner link={link} ids={reqs.map((r) => r.id)} outbox={outbox} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 16, marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
          {Object.entries(ITEMS).filter(([k]) => prices?.items?.[k]).map(([k, v]) => (
            <Chip key={k} on={item === k} label={v} tint={OK} onPress={() => { setItem(k); setChangedAt(Date.now()); }} />
          ))}
        </ScrollView>

        <View style={{ marginHorizontal: -10, marginTop: 6 }}>
          <CapTowers width={width - 20} data={data} changedAt={changedAt} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: -4 }}>
          <ShieldCheck size={15} color={OK} />
          <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18, flex: 1 }}>
            The glass is the cap: normal price {data ? money(data.base) : ''} + {capPct}% = {data ? money(data.cap) : ''}. Sellers above it are skipped and logged.
          </Text>
        </View>

        <Card tint={OK}>
          <Label tint={OK}>ASK EVERY PHARMACY AT ONCE</Label>
          <Stepper label={ITEMS[item]} sub="A few days’ worth: stock is shared by everyone" value={qty} min={1} max={60} onChange={setQty} tint={OK} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700' }}>Critical shortage: allow above-cap offers</Text>
              <Text style={{ color: c.dim, fontSize: 12, lineHeight: 16 }}>Off by default. If on, it is recorded in the audit log with your hospital’s name.</Text>
            </View>
            <Switch accessibilityLabel="Allow above-cap offers" value={allow} onValueChange={setAllow} trackColor={{ true: c.amber, false: '#334155' }} thumbColor="#fff" />
          </View>
          <Pressable accessibilityRole="button" onPress={() => ask()} disabled={!hospital} style={({ pressed }) => [{ marginTop: 14, borderRadius: 18, overflow: 'hidden' }, pressed && { opacity: 0.85 }]}>
            <LinearGradient colors={['#34d399', '#059669']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Send size={18} color="#04241a" /><Text style={{ color: '#04241a', fontSize: 16, fontWeight: '900' }}>Request {qty} × {ITEMS[item]}</Text>
            </LinearGradient>
          </Pressable>
        </Card>

        {reqs.map((r) => (
          <Card key={r.id} tint={OK} active>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Receipt size={16} color={OK} />
              <Text style={{ color: c.ink, fontSize: 15, fontWeight: '800', flex: 1 }}>{r.qty} × {ITEMS[r.item]}</Text>
              <Text style={{ color: c.dim, fontSize: 11.5, fontFamily: mono }}>#{r.id}{r.allow ? ' · ALLOW' : ''}</Text>
            </View>
            <Result req={r} res={supplyResult(inbox, r.id)} item={r.item} base={prices?.items?.[r.item]?.base}
              onAllow={() => ask(r.item, supplyResult(inbox, r.id)?.short || r.qty, true)} />
          </Card>
        ))}

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Label style={{ flex: 1, marginBottom: 0 }}>FAIR-PRICE BOARD · {ITEMS[item]?.toUpperCase()}</Label>
            <Text style={{ color: c.dim, fontSize: 11 }}>{prices?.source === 'live' ? 'live' : prices?.source === 'cached' ? `saved ${ago(prices.at, now)}` : 'bundled demo'}</Text>
          </View>
          {data ? data.offers.map((o) => <PriceRow key={o.pharm} o={o} base={data.base} cap={data.cap} scale={scale} w={width - 72} />) : null}
          <View style={{ flexDirection: 'row', gap: 14, marginTop: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 3, height: 12, backgroundColor: OK, borderRadius: 2 }} /><Text style={{ color: c.muted, fontSize: 11.5 }}>Cap {data ? money(data.cap) : ''}</Text></View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><View style={{ width: 2, height: 12, backgroundColor: '#e2e8f0', opacity: 0.6 }} /><Text style={{ color: c.muted, fontSize: 11.5 }}>Normal {data ? money(data.base) : ''}</Text></View>
          </View>
          <Text style={{ color: c.dim, fontSize: 11.5, marginTop: 8 }}>{prices?.note || 'Demo prices'} · CAD per unit</Text>
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <BadgePercent size={16} color="#fda4af" />
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '800', flex: 1 }}>Price ledger</Text>
            <Link2 size={13} color={c.dim} /><Text style={{ color: c.dim, fontSize: 11 }}>hash-chained</Text>
          </View>
          <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>
            Every request, every skipped over-cap offer and every override is written to the command centre’s audit log. Each entry carries the hash of the one before, so nobody can quietly edit it afterwards. The after-action review reads the same log.
          </Text>
          {flags.length ? flags.slice(0, 6).map((f, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderColor: c.line, marginTop: i ? 0 : 10 }}>
              <TriangleAlert size={14} color={BAD} />
              <Text style={{ color: c.ink, fontSize: 13, flex: 1 }}>{PLACES[f.pharm] || f.name} · {ITEMS[f.item] || f.item}</Text>
              <Text style={{ color: '#fda4af', fontSize: 12.5, fontWeight: '700' }}>{money(f.price)} (+{Math.round(f.pct)}%)</Text>
              <Text style={{ color: c.dim, fontSize: 11, fontFamily: mono }}>{f.time}</Text>
            </View>
          )) : <Text style={{ color: c.dim, fontSize: 12.5, marginTop: 10 }}>No over-cap offers flagged yet.</Text>}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
