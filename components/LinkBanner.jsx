import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { Bluetooth, BluetoothSearching, CircleCheck, Navigation, Settings, Wifi, WifiOff } from 'lucide-react-native';
import { c } from '../medmesh-id/theme';
import { bluetoothSupport, connectBluetooth } from '../link/meshLink';
import { getPosition } from '../dashboard/hazardService';
import { DEFAULT_POS, nearestNode } from '../dashboard/sites';
import { useClock } from '../ui3d/project';

// Shown above every form: how messages leave this phone. Points to the nearest MedMesh node (GPS works offline) and
// connects to it over Bluetooth, or explains exactly what to do if Bluetooth is off or not available here.

const HELP = {
  native: 'Bluetooth needs the MedMesh app build. Until then, messages go through the Wi-Fi test mesh.',
  unsupported: 'This browser can’t use Bluetooth. Open MedMesh in Chrome on Android, or the Bluefy browser on iPhone.',
  insecure: 'Open the secure (https) MedMesh link to use Bluetooth.',
  off: 'Bluetooth is off. Turn it on in Settings, then tap Connect again.',
  cancel: 'No node chosen. Tap Connect and pick the MedMesh node in the list.',
  fail: 'Could not connect. Move closer to the node (Bluetooth reaches about 10-30 m) and try again.',
};

function Radar({ active }) {
  const { t } = useClock(active, 24);
  const k = (t % 1.6) / 1.6;
  return (
    <Svg width={34} height={26}>
      <Ellipse cx={17} cy={16} rx={15} ry={7} stroke={c.sky} strokeOpacity={0.35} fill="none" />
      <Ellipse cx={17} cy={16} rx={15 * k} ry={7 * k} stroke={c.sky} strokeOpacity={1 - k} fill="none" />
      <Circle cx={17} cy={11} r={3.5} fill={c.sky} />
    </Svg>
  );
}

export default function LinkBanner({ link, ids = [], outbox = [] }) {
  const [node, setNode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState('');
  const mine = outbox.filter((o) => ids.includes(o.id));
  const acked = mine.filter((o) => o.status === 'acked').length;
  const waiting = mine.filter((o) => o.status === 'queued').length;

  useEffect(() => {
    let alive = true;
    getPosition().then((p) => alive && setNode(nearestNode(p || DEFAULT_POS)));
    return () => { alive = false; };
  }, []);

  async function connect() {
    setHelp('');
    const sup = bluetoothSupport();
    if (sup !== 'ok') { setHelp(HELP[sup]); return; }
    setBusy(true);
    try {
      await connectBluetooth();
    } catch (e) {
      setHelp(HELP[e.code] || (e.name === 'NotFoundError' ? HELP.cancel : HELP.fail));
    } finally {
      setBusy(false);
    }
  }

  const ble = link.kind === 'ble' && link.connected;
  const wifi = link.kind === 'wifi-sim' && link.connected;
  let tone = c.amber;
  let Icon = Bluetooth;
  let title = 'Connect to the nearest MedMesh node';
  let sub = node ? `${node.name} · ${node.km < 1 ? `${Math.round(node.km * 1000)} m` : `${node.km.toFixed(1)} km`} ${node.dir}` : 'Finding the nearest node…';
  if (ble) { tone = c.green; title = `Connected to ${link.nodeName || 'a MedMesh node'}`; sub = 'Over Bluetooth. Messages go out by long-range radio.'; }
  else if (wifi) { tone = c.green; Icon = Wifi; title = 'Connected to the command centre'; sub = 'Test mesh over Wi-Fi. Messages travel the same way as over radio.'; }
  else if (link.kind === 'wifi-sim') { Icon = WifiOff; }

  return (
    <View style={{ padding: 12, borderRadius: 18, borderWidth: 1, borderColor: tone + '55', backgroundColor: tone + '10', marginTop: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        {!ble && !wifi ? <Radar active /> : <Icon size={18} color={tone} />}
        <View style={{ flex: 1 }}>
          <Text style={{ color: tone === c.green ? '#bbf7d0' : '#fde68a', fontSize: 14, fontWeight: '800' }}>{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
            {!ble && !wifi && node ? <Navigation size={11} color={c.muted} /> : null}
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17, flex: 1 }}>{sub}</Text>
          </View>
        </View>
        {!ble ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Connect over Bluetooth" onPress={connect} disabled={busy}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: c.blue6 }, pressed && { opacity: 0.85 }]}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <BluetoothSearching size={15} color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>{busy ? 'Looking…' : 'Connect'}</Text>
          </Pressable>
        ) : null}
      </View>
      {help ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <Text style={{ color: c.ink, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{help}</Text>
          {Platform.OS !== 'web' && /Settings/.test(help) ? (
            <Pressable accessibilityRole="button" onPress={() => Linking.openSettings()} style={{ flexDirection: 'row', gap: 5, alignItems: 'center', padding: 8, borderRadius: 10, borderWidth: 1, borderColor: c.line2 }}>
              <Settings size={13} color={c.ink} /><Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>Settings</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {!ble && !wifi && !help ? <Text style={{ color: c.dim, fontSize: 11.5, marginTop: 8 }}>Everything is saved on this phone and sends by itself once connected.</Text> : null}
      {mine.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <CircleCheck size={13} color={acked === mine.length ? c.green : c.dim} />
          <Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>
            {acked} of {mine.length} received by the command centre{waiting ? ` · ${waiting} waiting to send` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
