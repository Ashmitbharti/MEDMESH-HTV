import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CircleCheck, Clock, Radio, Send, ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useMesh } from '../link/meshLink';
import { useClock } from '../ui3d/project';
import { ago, Card, Label, Stepper } from '../hospital/controls';
import { DEMO_BASE } from '../hospital/hospitalService';
import StockShelf, { levelOf } from './StockShelf';
import { usePharmacy } from './PharmacyContext';
import { capOf, changes, consumed, fullOf, ITEMS, loadStock, LOW, sendStock, stockAcked, stockWires } from './pharmacyService';

export default function Stock() {
  const { width } = useWindowDimensions();
  const { pharmacy } = usePharmacy();
  const { inbox } = useMesh();
  const { now } = useClock(true, 1);
  const [sent, setSent] = useState(null);
  const [draft, setDraft] = useState(null);
  const [sel, setSel] = useState(null);
  const [bumpAt, setBumpAt] = useState(0);
  const [priceText, setPriceText] = useState('');

  useEffect(() => {
    if (!pharmacy) return;
    loadStock(pharmacy.id).then((s) => { setSent(s); setDraft(s); setSel(Object.keys(s.items)[0]); setPriceText(String(Object.values(s.items)[0]?.price ?? '')); });
  }, [pharmacy]);

  if (!pharmacy || !draft) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  // The command centre takes accepted requests and hospital orders off our stock; mirror that here (unless staff typed a new count).
  const used = {};
  for (const x of consumed(inbox, pharmacy.id, sent.sentAt)) used[x.item] = (used[x.item] || 0) + x.qty;
  const after = (k) => Math.max(0, sent.items[k].qty - (used[k] || 0));
  const sentView = { ...sent, items: Object.fromEntries(Object.keys(sent.items).map((k) => [k, { ...sent.items[k], qty: after(k) }])) };
  const view = { ...draft, items: Object.fromEntries(Object.keys(draft.items).map((k) => [k, {
    ...draft.items[k], qty: sent.items[k] && draft.items[k].qty === sent.items[k].qty ? after(k) : draft.items[k].qty,
  }])) };
  const it = view.items[sel] || { qty: 0, price: 0 };
  const setItem = (patch) => { setDraft((d) => ({ ...d, items: { ...d.items, [sel]: { ...d.items[sel], ...patch } } })); setBumpAt(Date.now()); };
  const choose = (k) => { setSel(k); setPriceText(String(view.items[k].price)); };
  const base = DEMO_BASE[sel];
  const cap = capOf(sel);
  const over = cap && it.price > cap;
  const pct = base ? Math.round(100 * (it.price / base - 1)) : 0;
  const keys = changes(view, sentView);
  const openChanged = draft.open !== sent.open;
  const wires = stockWires(pharmacy.id, view, keys.length ? keys : Object.keys(view.items).slice(0, 1));
  const acked = stockAcked(inbox, sent.sentAt);
  const lv = levelOf(sel, it.qty);

  async function send() {
    const at = await sendStock(pharmacy.id, view, keys.length ? keys : Object.keys(view.items));
    const next = { ...view, sentAt: at };
    setSent(next);
    setDraft(next);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(125,211,252,0.18)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: c.sky, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>STOCK & PRICES · {pharmacy.short.toUpperCase()}</Text>
        <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>Your shelf, as the{'\n'}mesh sees it.</Text>
        <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 6 }}>
          Only emergency items. When you accept a request, the command centre takes it off for you, so you only fix counts now and then.
        </Text>

        <View style={{ marginHorizontal: -10, marginTop: 6 }}>
          <StockShelf width={width - 20} items={view.items} selected={sel} onSelect={choose} open={draft.open} bumpAt={bumpAt} />
        </View>
        <Text style={{ color: c.dim, fontSize: 11.5, textAlign: 'center', marginTop: -2 }}>Tap a bottle to edit · drag to look along the shelf</Text>

        <Card tint={lv.tint} active>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Label tint={lv.tint} style={{ flex: 1, marginBottom: 0 }}>{(ITEMS[sel] || sel).toUpperCase()}</Label>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: lv.tint + '26' }}>
              <Text style={{ color: lv.tint, fontSize: 11, fontWeight: '900' }}>{lv.label.toUpperCase()}</Text>
            </View>
          </View>
          <Stepper label="In stock" sub={`A full shelf is about ${fullOf(sel)}`} value={it.qty} onChange={(v) => setItem({ qty: v })} tint={lv.tint} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            {[['Out', 0], ['Low', LOW(sel)], ['Full', fullOf(sel)]].map(([l, v]) => (
              <Pressable key={l} accessibilityRole="button" accessibilityLabel={`Set ${l}`} onPress={() => setItem({ qty: v })}
                style={{ flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: it.qty === v ? lv.tint : c.line2 }}>
                <Text style={{ color: c.ink, fontSize: 13.5, fontWeight: '800' }}>{l}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>Your price</Text>
              <Text style={{ color: c.dim, fontSize: 12 }}>{base ? `Normal $${base.toFixed(2)} · cap $${cap.toFixed(2)} (+10%)` : 'No normal price on file'}</Text>
            </View>
            <Text style={{ color: c.muted, fontSize: 20, fontWeight: '800' }}>$</Text>
            <TextInput accessibilityLabel="Your price" value={priceText} keyboardType="decimal-pad"
              onChangeText={(s) => { const clean = s.replace(/[^0-9.]/g, ''); setPriceText(clean); const n = Number(clean); if (Number.isFinite(n) && clean) setItem({ price: Math.round(n * 100) / 100 }); }}
              style={{ width: 96, height: 46, borderRadius: 14, textAlign: 'center', color: over ? '#fda4af' : c.ink, fontSize: 19, fontWeight: '800', backgroundColor: '#070b17', borderWidth: 1, borderColor: over ? '#f43f5e' : c.line2 }} />
          </View>
          {base ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 10, padding: 11, borderRadius: 14, backgroundColor: over ? 'rgba(244,63,94,0.12)' : 'rgba(52,211,153,0.1)' }}>
              {over ? <TriangleAlert size={15} color="#fb7185" /> : <ShieldCheck size={15} color={c.green} />}
              <Text style={{ color: over ? '#fecdd3' : '#bbf7d0', fontSize: 12.5, lineHeight: 18, flex: 1 }}>
                {over
                  ? `${pct}% above normal. Requests go to fair-priced places first, hospitals skip you unless they accept it for a critical shortage, and it is recorded in the audit log.`
                  : `Fair price${pct > 0 ? ` (+${pct}%)` : ''}. You stay first in line for requests nearby.`}
              </Text>
            </View>
          ) : null}
        </Card>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>Open for requests</Text>
              <Text style={{ color: c.dim, fontSize: 12 }}>Turn off if you have to close: nobody is sent to you.</Text>
            </View>
            <Switch accessibilityLabel="Open for requests" value={draft.open} onValueChange={(v) => setDraft((d) => ({ ...d, open: v }))} trackColor={{ true: c.green, false: '#334155' }} thumbColor="#fff" />
          </View>
        </Card>

        <Pressable accessibilityRole="button" onPress={send} disabled={!keys.length && !openChanged && !!sent.sentAt}
          style={({ pressed }) => [{ marginTop: 18, borderRadius: 18, overflow: 'hidden' }, !keys.length && !openChanged && !!sent.sentAt && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
          <LinearGradient colors={['#38bdf8', '#2563eb']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Send size={18} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 16.5, fontWeight: '800' }}>
              {keys.length ? `Send ${keys.length} change${keys.length > 1 ? 's' : ''}` : openChanged ? 'Send open / closed' : sent.sentAt ? 'Up to date' : 'Send my stock'}
            </Text>
          </LinearGradient>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <Radio size={13} color={c.dim} />
          <Text style={{ color: c.dim, fontSize: 11.5, fontFamily: mono, flex: 1 }} numberOfLines={1}>{wires[0]}</Text>
          <Text style={{ color: c.dim, fontSize: 11.5 }}>{wires.length > 1 ? `${wires.length} msgs` : `${new TextEncoder().encode(wires[0]).length}/200 B`}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          {acked ? <CircleCheck size={14} color={c.green} /> : <Clock size={14} color={c.dim} />}
          <Text style={{ color: c.muted, fontSize: 12.5 }}>
            Last sent {ago(sent.sentAt, now)}{sent.sentAt ? (acked ? ' · received ✓✓' : ' · sending…') : ''}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
