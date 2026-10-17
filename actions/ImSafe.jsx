import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { ChevronLeft, CircleCheck, Clock, HandHelping, HeartHandshake, Phone } from 'lucide-react-native';
import s from './Actions.styles';
import { c } from '../medmesh-id/theme';
import { loadProfile } from '../medmesh-id/profileService';
import { getPosition, ago } from '../dashboard/hazardService';
import { latest, newId, queue } from '../dashboard/outbox';
import LinkBanner from '../components/LinkBanner';
import { useMesh } from '../link/meshLink';

// Community check-in: O|id|SAFE or NEED|name|lat,lon|medmeshID  (handled by the command centre's h_checkin)
export default function ImSafe() {
  const { link, outbox } = useMesh();
  const [profile, setProfile] = useState(null);
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => {
    loadProfile().then(setProfile).catch(() => {});
    latest('checkin').then((x) => setLast(x && Date.now() - x.at < 12 * 3600 * 1000 ? x : null));
  }, []));

  const d = profile?.details || {};
  const contact = d.contact && !/^none$/i.test(d.contact) ? d.contact : '';

  async function send(kind) {
    setBusy(true);
    const pos = await getPosition();
    const id = newId();
    const name = (d.name || 'Unknown').replace(/\|/g, ' ').slice(0, 24);
    const where = pos ? `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}` : '';
    // the MedMesh ID (if any) tells the opt-in registry this person is fine, so nobody is sent to check on them
    const item = await queue('checkin', `O|${id}|${kind}|${name}|${where}|${profile?.medmeshId || ''}`, { status: 'queued', checkKind: kind });
    setLast(item);
    setBusy(false);
  }

  const fresh = !!last;

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <LinearGradient colors={['rgba(52,211,153,0.22)', 'rgba(5,7,15,0)']} style={s.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={s.content}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={s.back}>
          <ChevronLeft size={18} color={c.muted} /><Text style={s.backText}>Home</Text>
        </Pressable>
        <LinkBanner link={link} ids={last ? [last.id] : []} outbox={outbox} />
        <Text style={s.eyebrow}>CHECK IN</Text>
        <Text style={s.title}>{"Let your people\nknow you're okay."}</Text>
        <Text style={s.sub}>One tap sends a tiny message over the mesh to the command centre, which tells your emergency contact.</Text>

        <Pressable accessibilityRole="button" disabled={busy} onPress={() => send('SAFE')} style={({ pressed }) => [pressed && s.pressed]}>
          <LinearGradient colors={['#10b981', '#047857']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.big}>
            <HeartHandshake size={46} color="#fff" strokeWidth={2} />
            <Text style={s.bigText}>{"I'm safe"}</Text>
            <Text style={s.bigSub}>{busy ? 'Saving…' : 'Tap to check in'}</Text>
          </LinearGradient>
        </Pressable>

        <Pressable accessibilityRole="button" disabled={busy} onPress={() => send('NEED')} style={({ pressed }) => [s.ghost, pressed && s.pressed]}>
          <HandHelping size={18} color={c.amber} />
          <Text style={s.ghostText}>{"I need help, but it's not urgent"}</Text>
        </Pressable>
        <Text style={s.hint}>{'Water, medicine, shelter or a ride. For an emergency, go back and hold "I need help".'}</Text>

        {fresh ? (
          <View style={[s.done, { borderColor: (last.checkKind === 'NEED' ? c.amber : c.green) + '66', backgroundColor: (last.checkKind === 'NEED' ? c.amber : c.green) + '12' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {last.status === 'acked' ? <CircleCheck size={20} color={c.green} /> : <Clock size={20} color={c.amber} />}
              <Text style={[s.doneTitle, { color: last.status === 'acked' ? c.green : '#fde68a' }]}>
                {last.status === 'acked' ? 'Received by the command centre' : 'Saved · waiting for a mesh node'}
              </Text>
            </View>
            <Text style={s.rowSub}>{last.checkKind === 'NEED' ? 'Non-urgent help request' : 'Safe check-in'} · {ago(last.at)}</Text>
            <Text style={s.wire}>{last.wire}</Text>
          </View>
        ) : null}

        <Text style={s.label}>WHO GETS TOLD</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Phone size={18} color={c.sky} />
            <View style={{ flex: 1 }}>
              <Text style={s.rowTitle}>{contact || 'No emergency contact yet'}</Text>
              <Text style={s.rowSub}>
                {contact ? 'Texted by the command centre once it has any connection.' : 'Add one in My ID so someone is told.'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
