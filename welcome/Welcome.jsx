import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { Building2, ChevronLeft, ChevronRight, CircleAlert, FlaskConical, HeartPulse, Landmark, Pill, Radio, User, WifiOff } from 'lucide-react-native';
import MeshRadar from './MeshRadar';
import s from './Welcome.styles';
import { c, grad } from '../medmesh-id/theme';
import { useAuth } from '../auth/AuthContext';
import { DEMO_ACCOUNTS, ROLES } from '../auth/authService';

const ROLE_ICON = { citizen: User, hospital: Building2, pharmacy: Pill, government: Landmark };
const ROLE_TINT = { citizen: c.sky, hospital: c.redl, pharmacy: c.green, government: c.violet };
const ROLE_SUB = {
  citizen: 'Your MedMesh ID, SOS, status, medicine and first aid',
  hospital: 'Share beds and see incoming patients',
  pharmacy: 'Answer medicine requests and share stock',
  government: 'Overview, analysis and the vulnerable-people watchlist',
};

export default function Welcome() {
  const { width } = useWindowDimensions();
  const { signIn, signUp, demo, enterCode } = useAuth();
  const [code, setCode] = useState('');
  const [role, setRole] = useState('citizen');
  const [picked, setPicked] = useState(null);
  const [mode, setMode] = useState('in'); // in | up
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  // the new demo citizen goes straight to MedMesh ID setup, to show how an ID is made
  const go = (a) => router.replace(a.demoId === 'citizen-new' ? '/profile' : ROLES[a.role].home);

  async function submit() {
    setError(''); setNote('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address.'); return; }
    if (password.length < 6) { setError('Use a password with at least 6 characters.'); return; }
    setBusy(true);
    try {
      if (mode === 'in') go(await signIn(email, password, role));
      else {
        const a = await signUp(email, password, role, name);
        if (a.needsConfirmation) { setNote('Check your email to confirm your account, then sign in.'); setMode('in'); } else go(a);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function tryDemo(r) {
    setError('');
    go(await demo(r));
  }

  const RoleIcon = ROLE_ICON[role];

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      <LinearGradient colors={['rgba(56,189,248,0.22)', 'rgba(5,7,15,0)']} style={s.glow} pointerEvents="none" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.brandRow}>
            <LinearGradient colors={grad.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.logo}>
              <HeartPulse size={18} color="#fff" strokeWidth={2.5} />
            </LinearGradient>
            <Text style={s.brand}>MedMesh</Text>
            <View style={s.offline}>
              <WifiOff size={11} color={c.green} />
              <Text style={s.offlineText}>Works offline</Text>
            </View>
          </View>

          <View style={{ marginHorizontal: -20 }}>
            <MeshRadar width={width} height={Math.min(340, width * 0.85)} />
          </View>
          <Text style={s.dragHint}>Drag to rotate · live mesh</Text>

          <Text style={s.title}>{"Emergency help that works when the networks don't."}</Text>
          <Text style={s.sub}>
            When phones and internet go down, MedMesh carries your SOS over a long-range radio mesh to a command
            centre that sends the right help to the right hospital.
          </Text>

          <Text style={[s.demoLabel, { marginTop: 22 }]}>HOW WOULD YOU LIKE TO ENTER?</Text>
          {!picked ? Object.entries(ROLES).map(([k, v], i) => {
            const I = ROLE_ICON[k];
            const tint = ROLE_TINT[k];
            return (
              <Pressable key={k} accessibilityRole="button" accessibilityLabel={`Enter as ${v.label}`} onPress={() => { setPicked(k); setRole(k); }}
                style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, marginBottom: 10,
                  backgroundColor: 'rgba(11,16,32,0.85)', borderWidth: 1, borderColor: tint + '55',
                  transform: [{ perspective: 800 }, { rotateX: pressed ? '0deg' : `${6 - i * 2}deg` }, { scale: pressed ? 0.98 : 1 }] }]}>
                <LinearGradient colors={[tint + '55', tint + '10']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: tint + '88' }}>
                  <I size={24} color={tint} strokeWidth={2.2} />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.ink, fontSize: 17.5, fontWeight: '800' }}>Enter as {v.label}</Text>
                  <Text style={{ color: c.muted, fontSize: 12.5, marginTop: 3, lineHeight: 17 }}>{ROLE_SUB[k]}</Text>
                </View>
                <ChevronRight size={20} color={tint} />
              </Pressable>
            );
          }) : (
            <Pressable accessibilityRole="button" onPress={() => setPicked(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, marginBottom: 6 }}>
              <ChevronLeft size={16} color={c.muted} />
              <Text style={{ color: c.muted, fontWeight: '700' }}>{ROLES[picked].label} · choose another role</Text>
            </Pressable>
          )}

          {picked ? (
          <>
          {picked === 'hospital' || picked === 'pharmacy' ? (
            <View style={[s.card, { marginBottom: 14 }]}>
              <Text style={s.cardLabel}>{picked === 'hospital' ? 'ENTER YOUR HOSID' : 'ENTER YOUR PHARMID'}</Text>
              <TextInput style={s.input} placeholder={picked === 'hospital' ? '100001' : '200001'} placeholderTextColor={c.dim} value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" accessibilityLabel={picked === 'hospital' ? 'HosID' : 'PharmID'} />
              <Pressable accessibilityRole="button" disabled={code.length !== 6}
                onPress={async () => { setError(''); try { go(await enterCode(picked, code)); } catch (e) { setError(e.message); } }}
                style={({ pressed }) => [s.cta, pressed && s.pressed, code.length !== 6 && { opacity: 0.5 }]}>
                <LinearGradient colors={grad.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ctaFill}>
                  <Text style={s.ctaText}>{picked === 'hospital' ? 'Open hospital dashboard' : 'Open pharmacy dashboard'}</Text>
                </LinearGradient>
              </Pressable>
              <Text style={[s.note, { marginTop: 8 }]}>
                {picked === 'hospital' ? 'Centenary 100001 · General 100002 · Birchmount 100003' : 'Care IDA 200001 · Food Basics 200002 · Highland Creek 200003'}
              </Text>
            </View>
          ) : null}
          <View style={s.card}>

            {mode === 'up' ? (
              <TextInput style={s.input} placeholder={role === 'citizen' ? 'Your name' : `${ROLES[role].label} name`}
                placeholderTextColor={c.dim} value={name} onChangeText={setName} accessibilityLabel="Name" />
            ) : null}
            <TextInput style={s.input} placeholder="Email" placeholderTextColor={c.dim} value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address" autoComplete="email" accessibilityLabel="Email" />
            <TextInput style={s.input} placeholder="Password" placeholderTextColor={c.dim} value={password} onChangeText={setPassword}
              secureTextEntry autoComplete={mode === 'in' ? 'current-password' : 'new-password'} accessibilityLabel="Password"
              onSubmitEditing={submit} />

            {error ? (
              <View style={s.err}><CircleAlert size={14} color={c.redl} /><Text style={s.errText} accessibilityRole="alert">{error}</Text></View>
            ) : null}
            {note ? <Text style={s.note}>{note}</Text> : null}

            <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={({ pressed }) => [s.cta, pressed && s.pressed, busy && { opacity: 0.6 }]}>
              <LinearGradient colors={grad.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ctaFill}>
                <RoleIcon size={17} color="#fff" strokeWidth={2.4} />
                <Text style={s.ctaText}>{busy ? 'Please wait…' : `${mode === 'in' ? 'Sign in' : 'Create account'} as ${ROLES[role].label.toLowerCase()}`}</Text>
              </LinearGradient>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); }} style={s.switch}>
              <Text style={s.switchText}>{mode === 'in' ? 'New here? ' : 'Have an account? '}<Text style={{ color: c.sky }}>{mode === 'in' ? 'Create an account' : 'Sign in'}</Text></Text>
            </Pressable>
          </View>

          <Text style={s.demoLabel}>OR TRY A DEMO ACCOUNT · NO INTERNET NEEDED</Text>
          {[picked].map((r) => (
            <View key={r} style={{ marginBottom: 6 }}>
              <Text style={[s.demoLabel, { marginTop: 6, marginBottom: 6, color: ROLE_TINT[r] }]}>{ROLES[r].label.toUpperCase()}</Text>
              {DEMO_ACCOUNTS.filter((a) => a.role === r).map((a) => {
                const I = ROLE_ICON[r];
                const tint = ROLE_TINT[r];
                return (
                  <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Demo ${a.name || 'new citizen'}`} onPress={() => tryDemo(a.id)}
                    style={({ pressed }) => [s.demo, pressed && s.pressed]}>
                    <View style={[s.demoIcon, { backgroundColor: tint + '1f' }]}><I size={17} color={tint} strokeWidth={2.2} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.demoTitle}>{a.name || 'New citizen'}</Text>
                      <Text style={s.demoSub}>{a.sub}</Text>
                    </View>
                    <ChevronRight size={18} color={c.dim} />
                  </Pressable>
                );
              })}
            </View>
          ))}

          </>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Open the test kit" onPress={() => router.push('/testkit')}
            style={({ pressed }) => [s.demo, { borderStyle: 'dashed', marginTop: 8 }, pressed && s.pressed]}>
            <View style={[s.demoIcon, { backgroundColor: 'rgba(251,191,36,0.14)' }]}><FlaskConical size={17} color={c.amber} strokeWidth={2.2} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.demoTitle}>Test kit</Text>
              <Text style={s.demoSub}>Fire a crash, medicine requests, a flood or a dead node at the command centre, then watch each screen react</Text>
            </View>
            <ChevronRight size={18} color={c.dim} />
          </Pressable>

          <View style={s.footer}>
            <Radio size={12} color={c.dim} />
            <Text style={s.footerText}>LoRa mesh · no SIM, Wi-Fi or towers needed</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
