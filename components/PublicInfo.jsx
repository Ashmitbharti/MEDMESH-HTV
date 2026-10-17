import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { BookOpenCheck, ChevronDown, ExternalLink } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { VERIFIED_ON } from '../dashboard/sites';

// Public reference details for a hospital or pharmacy (gathered from official / published sources by Ashmit).
// Clearly separated from the live, simulated numbers the facility reports during the emergency.
export default function PublicInfo({ site, tint = c.sky }) {
  const [open, setOpen] = useState(false);
  if (!site?.address) return null;
  return (
    <View style={{ marginTop: 12, borderRadius: 18, backgroundColor: 'rgba(11,16,32,0.8)', borderWidth: 1, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Public information" onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 }}>
        <BookOpenCheck size={15} color={tint} />
        <Text style={{ color: c.ink, fontSize: 13.5, fontWeight: '800', flex: 1 }}>
          Public information{site.beds ? ` · ${site.beds} beds${site.bedsSimulated ? ' (assumed)' : ''}` : ''}
        </Text>
        <ChevronDown size={16} color={c.muted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 5 }}>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>{site.address}{site.phone ? ` · ${site.phone}` : ''}</Text>
          {site.hours ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{site.hours}</Text> : null}
          {site.services?.length ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{site.services.join(' · ')}</Text> : null}
          {site.beds ? (
            <Text style={{ color: c.dim, fontSize: 12 }}>
              {site.bedsSimulated ? `${site.beds} beds is a demo assumption.` : `${site.beds} beds in total (${site.bedsNote || 'published figure'}).`} Free beds, ICU, waits and stock in this app are simulated.
            </Text>
          ) : <Text style={{ color: c.dim, fontSize: 12 }}>Stock, prices and opening status in this app are simulated.</Text>}
          {(site.sources || []).map((s) => (
            <Pressable key={s.url} accessibilityRole="link" onPress={() => Linking.openURL(s.url)} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <ExternalLink size={11} color={tint} />
              <Text style={{ color: tint, fontSize: 12, fontWeight: '700' }}>{s.title}</Text>
            </Pressable>
          ))}
          <Text style={{ color: c.dim, fontSize: 10.5, fontFamily: mono, marginTop: 2 }}>CHECKED {VERIFIED_ON}{site.code ? ` · ENTRY CODE ${site.code}` : ''}</Text>
        </View>
      ) : null}
    </View>
  );
}
