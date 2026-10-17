import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { pharmacies } from '../command-center/facilities';
import { loadPharmacies } from '../command-center/pharmacyService';
import styles from './Pharmacy.styles';

export default function PharmacyEntry() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);

  async function enter() {
    if (opening.current) return;
    if (!/^\d{6}$/.test(code)) { setError('Enter your six-digit PharmID.'); return; }
    opening.current = true;
    setBusy(true);
    setError('');
    try {
      let pharmacy = pharmacies.find((item) => item.pharmacyCode === code);
      if (!pharmacy) pharmacy = (await loadPharmacies()).find((item) => item.pharmacyCode === code);
      if (!pharmacy) { setError('No pharmacy matches this PharmID. Check the code and try again.'); return; }
      router.push({ pathname: '/pharmacy/dashboard', params: { pharmacyId: pharmacy.id } });
    } catch {
      setError('Could not check this PharmID. Please try again.');
    } finally {
      opening.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>MEDMESH · PHARMACY</Text>
        <Text style={styles.title}>Enter your PharmID</Text>
        <Text style={styles.description}>Use your pharmacy’s six-digit code to open its dashboard.</Text>
        <Text style={styles.label}>Pharmacy ID</Text>
        <TextInput accessibilityLabel="Six-digit pharmacy ID" style={styles.input} keyboardType="number-pad"
          maxLength={6} value={code} onChangeText={(value) => { setCode(value.replace(/\D/g, '')); setError(''); }}
          placeholder="000000" placeholderTextColor="#777d89" editable={!busy} onSubmitEditing={enter} />
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={enter}>
          <Text style={styles.primaryText}>{busy ? 'Checking PharmID…' : 'Open pharmacy dashboard'}</Text>
        </Pressable>
        <Text style={styles.hint}>Demo access · choose a pharmacy by PharmID and update its simulated inventory.</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.link}>Switch role</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
