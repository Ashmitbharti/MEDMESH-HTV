import { Text, View } from 'react-native';
import { Bluetooth, CircleCheck, Wifi, WifiOff } from 'lucide-react-native';
import { c } from '../medmesh-id/theme';

// Shown above every emergency form: how (and whether) messages are leaving this phone right now.
export default function LinkBanner({ link, ids = [], outbox = [] }) {
  const mine = outbox.filter((o) => ids.includes(o.id));
  const acked = mine.filter((o) => o.status === 'acked').length;
  const waiting = mine.filter((o) => o.status === 'queued').length;
  let tone = c.amber;
  let Icon = Bluetooth;
  let title = 'Not connected to a MedMesh node';
  let sub = 'Everything is saved on this phone and sends by itself when a node is in range.';
  if (link.kind === 'wifi-sim' && link.connected) {
    tone = c.green; Icon = Wifi; title = 'Connected to the command centre';
    sub = 'Test mesh over Wi-Fi. Messages travel the same way as over radio.';
  } else if (link.kind === 'wifi-sim') {
    Icon = WifiOff; title = 'Command centre not reachable'; sub = 'Saved on this phone. Retrying every few seconds.';
  }
  return (
    <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: tone + '55', backgroundColor: tone + '10', marginTop: 12 }}>
      <Icon size={17} color={tone} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: tone === c.green ? '#bbf7d0' : '#fde68a', fontSize: 14, fontWeight: '800' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>{sub}</Text>
        {mine.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <CircleCheck size={13} color={acked === mine.length ? c.green : c.dim} />
            <Text style={{ color: c.ink, fontSize: 12, fontWeight: '700' }}>
              {acked} of {mine.length} received by the command centre{waiting ? ` · ${waiting} waiting to send` : ''}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
