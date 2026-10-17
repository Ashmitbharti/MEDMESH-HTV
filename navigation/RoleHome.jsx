import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { Building2, LogOut, Pill } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { ROLES } from '../auth/authService';

// Hospital and pharmacy accounts: signed in correctly, dashboards come next.
export default function RoleHome({ role }) {
  const { account, ready, signOut } = useAuth();
  if (!ready) return null;
  if (!account) return <Redirect href="/welcome" />;
  if (account.role !== role) return <Redirect href={ROLES[account.role].home} />;
  const Icon = role === 'hospital' ? Building2 : Pill;
  const tint = role === 'hospital' ? c.redl : c.amber;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient colors={[tint + '33', 'rgba(5,7,15,0)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }} />
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: tint + '22' }}>
          <Icon size={30} color={tint} />
        </View>
        <Text style={{ color: tint, fontFamily: mono, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 22 }}>
          {ROLES[role].label.toUpperCase()} ACCOUNT
        </Text>
        <Text style={{ color: c.ink, fontSize: 30, fontWeight: '800', marginTop: 6 }}>{account.name || account.email}</Text>
        <Text style={{ color: c.muted, fontSize: 15, lineHeight: 22, marginTop: 10 }}>
          Signed in as {account.email}. The {ROLES[role].label.toLowerCase()} dashboard is the next screen we build.
        </Text>
        <Pressable accessibilityRole="button" onPress={async () => { await signOut(); router.replace('/welcome'); }}
          style={{ marginTop: 28, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: c.line2 }}>
          <LogOut size={17} color={c.ink} />
          <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
