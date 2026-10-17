import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { hospitals } from '../command-center/facilities';
import { loadHospitals } from '../command-center/hospitalService';
import styles from './Hospital.styles';

export default function HospitalEntry() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);

  async function enter() {
    if (opening.current) return;
    if (!/^\d{6}$/.test(code)) { setError('Enter your six-digit HosID.'); return; }
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      let hospital = hospitals.find((item) => item.hospitalCode === code);
      if (!hospital) hospital = (await loadHospitals()).find((item) => item.hospitalCode === code);
      if (!hospital) { setError('No hospital matches this HosID. Check the code and try again.'); return; }
      router.push({ pathname: '/hospital/dashboard', params: { hosid: hospital.hosid } });
    } catch {
      setError('Could not check this HosID. Please try again.');
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>MEDMESH · HOSPITAL</Text>
        <Text style={styles.title}>Enter your HosID</Text>
        <Text style={styles.description}>Use your hospital’s six-digit code to open its dashboard.</Text>
        <Text style={styles.label}>Hospital ID</Text>
        <TextInput accessibilityLabel="Six-digit hospital ID" style={styles.input} keyboardType="number-pad"
          maxLength={6} value={code} onChangeText={(value) => { setCode(value.replace(/\D/g, '')); setError(''); }}
          placeholder="000000" placeholderTextColor="#777d89" editable={!busy} onSubmitEditing={enter} />
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={enter}>
          <Text style={styles.primaryText}>{busy ? 'Checking HosID…' : 'Open hospital dashboard'}</Text>
        </Pressable>
        <Text style={styles.hint}>Demo access · choose a hospital by HosID and update its simulated availability.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.link}>Switch role</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
