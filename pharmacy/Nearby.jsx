import { useEffect, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { EyeOff, Lightbulb, Radar } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useMesh } from '../link/meshLink';
import { useClock } from '../ui3d/project';
import { ago, Card, Label } from '../hospital/controls';
import DemandRose from './DemandRose';
import { usePharmacy } from './PharmacyContext';
import { demand, ITEMS, loadStock } from './pharmacyService';

const BAR = '#a78bfa';
const UNMET = '#f43f5e';

export default function Nearby() {
  const { width } = useWindowDimensions();
  const { pharmacy } = usePharmacy();
  const { inbox } = useMesh();
  const { now } = useClock(true, 1);
  const [stock, setStock] = useState(null);
  useEffect(() => { if (pharmacy) loadStock(pharmacy.id).then(setStock); }, [pharmacy, inbox.length]);

  const d = pharmacy ? demand(inbox, pharmacy.id) : null;
  const items = d?.items || [];
  const max = Math.max(1, ...items.map((x) => x.asked));
  const total = items.reduce((a, x) => a + x.asked, 0);
  const tips = items.flatMap((x) => {
    const have = stock?.items?.[x.item]?.qty;
    const name = (ITEMS[x.item] || x.item).toLowerCase();
    if (x.unmet) return [`${x.unmet} ${name} asked for nearby could not be found anywhere. If another branch or wholesaler has some, this is where it is needed.`];
    if (have != null && have < x.asked) return [`${x.asked} ${name} asked for nearby and you have ${have}. Worth restocking.`];
    return [];
  }).slice(0, 3);
  const w = width - 72;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(167,139,250,0.2)', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }} pointerEvents="none" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }}>
        <Text style={{ color: c.violet, fontFamily: mono, fontSize: 10.5, letterSpacing: 2, fontWeight: '700' }}>NEARBY NEEDS</Text>
        <Text style={{ color: c.ink, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.6, marginTop: 4 }}>What people around{'\n'}you are asking for.</Text>
        <Text style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>
          {d ? `${total} item${total === 1 ? '' : 's'} asked within 5 km in the last ${d.hours} h · updated ${ago(d.at, now)}` : 'Updates arrive by radio whenever someone near you asks for something.'}
        </Text>

        <View style={{ marginHorizontal: -10, marginTop: 4 }}>
          <DemandRose width={width - 20} sectors={d?.sectors || {}} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: -6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: '#f472b6' }} /><Text style={{ color: c.muted, fontSize: 12 }}>Within 1.5 km</Text></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: BAR }} /><Text style={{ color: c.muted, fontSize: 12 }}>1.5–5 km</Text></View>
        </View>

        <Card tint={BAR}>
          <Label tint={BAR}>ASKED FOR, BY ITEM</Label>
          {items.length ? items.map((x) => (
            <View key={x.item} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '700', flex: 1 }}>{ITEMS[x.item] || x.item}</Text>
                <Text style={{ color: c.ink, fontSize: 14, fontWeight: '800' }}>{x.asked}</Text>
                {x.unmet ? <Text style={{ color: '#fda4af', fontSize: 12, fontWeight: '700' }}>  · {x.unmet} not found</Text> : null}
              </View>
              <View style={{ flexDirection: 'row', height: 8, marginTop: 5, width: w, borderRadius: 4, backgroundColor: c.line, overflow: 'hidden' }}>
                <View style={{ width: ((x.asked - x.unmet) / max) * w, backgroundColor: BAR }} />
                {x.unmet ? <View style={{ width: (x.unmet / max) * w - 2, marginLeft: 2, backgroundColor: UNMET }} /> : null}
              </View>
            </View>
          )) : <Text style={{ color: c.dim, fontSize: 13 }}>Nothing asked nearby yet.</Text>}
          {items.some((x) => x.unmet) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: UNMET }} /><Text style={{ color: c.muted, fontSize: 12 }}>Not found anywhere nearby</Text>
            </View>
          ) : null}
        </Card>

        {tips.length ? (
          <Card tint={c.amber} active>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Lightbulb size={16} color={c.amber} /><Text style={{ color: c.ink, fontSize: 15, fontWeight: '800' }}>Worth restocking</Text>
            </View>
            {tips.map((tip) => <Text key={tip} style={{ color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 6 }}>• {tip}</Text>)}
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: c.line }}>
          <EyeOff size={16} color={c.dim} />
          <Text style={{ color: c.dim, fontSize: 12.5, lineHeight: 18, flex: 1 }}>
            Counts only: which items and which direction, within 5 km. No names, MedMesh IDs or addresses are ever sent to pharmacies.
          </Text>
        </View>
        {!d ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' }}>
            <Radar size={15} color={c.dim} /><Text style={{ color: c.dim, fontSize: 12.5 }}>Listening for the next update…</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
