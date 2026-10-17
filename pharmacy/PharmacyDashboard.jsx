import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { loadPharmacies } from '../command-center/pharmacyService';
import { catalogue } from './catalogue';
import { readPharmacyUpdates, savePharmacyAvailability, syncPharmacyAvailability } from './pharmacyStore';
import styles from './Pharmacy.styles';

function initialValues(pharmacy) {
  const status = pharmacy.pharmacyAvailability;
  return {
    stock: Object.fromEntries(catalogue.map((item) => [item.id, String(status?.stock?.[item.id] ?? '')])),
    open: status?.open ?? true,
    waitMinutes: String(status?.waitMinutes ?? ''),
    services: status?.services || pharmacy.services,
  };
}

export default function PharmacyDashboard() {
  const { pharmacyId } = useLocalSearchParams();
  const id = typeof pharmacyId === 'string' ? pharmacyId : '';
  const [pharmacy, setPharmacy] = useState(null);
  const [values, setValues] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lastSaved, setLastSaved] = useState(null);
  const saving = useRef(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([loadPharmacies(), readPharmacyUpdates()]).then(([records, local]) => {
      if (!active) return;
      const record = records.find((item) => item.id === id);
      if (!record) throw new Error('No pharmacy found for this PharmID.');
      setPharmacy(record);
      setValues(initialValues(record));
      setLastSaved(local[id] || null);
      setMessage(record.loadedFromCloud ? 'Pharmacy details loaded from Supabase.' : 'Using saved pharmacy details.');
    }).catch((error) => {
      if (active) setError(error.message || 'Could not load this pharmacy.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]));

  function change(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setError('');
  }

  async function save(retry = false) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setMessage('Saving demo inventory…');
    try {
      const result = retry ? await syncPharmacyAvailability(pharmacy.id, lastSaved)
        : await savePharmacyAvailability(pharmacy, values);
      setLastSaved(result.update);
      setMessage(result.message);
    } catch (error) {
      setMessage('');
      setError(error.message || 'Could not save your changes.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const lowStock = values ? catalogue.filter((item) => values.stock[item.id] !== '' && Number(values.stock[item.id]) <= 10).length : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <Text style={styles.eyebrow}>PHARMACY DASHBOARD</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace('/pharmacy')}>
            <Text style={styles.link}>Change pharmacy</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{pharmacy?.name || 'Pharmacy'}</Text>
        {loading ? <Text style={styles.hint}>Loading pharmacy details…</Text> : null}
        {!loading && pharmacy && values ? (
          <>
            <Text style={styles.description}>PharmID {pharmacy.pharmacyCode} · {pharmacy.address}</Text>
            <View style={styles.banner}>
              <Ionicons name="flask-outline" size={22} color="#c5a3ff" />
              <Text style={styles.bannerText}>Demo workspace · stock and availability are simulated.</Text>
            </View>
            <View style={styles.stats}>
              {[
                ['Tracked items', catalogue.length, 'Demo catalogue'],
                ['Low stock', lowStock, 'Demo threshold: 10 units or fewer'],
                ['Preparation', values.waitMinutes === '' ? '—' : `${values.waitMinutes}m`, 'Simulated estimate'],
              ].map(([label, value, hint]) => (
                <View key={label} style={styles.stat}>
                  <Text style={styles.hint}>{label}</Text>
                  <Text style={styles.statValue}>{value}</Text>
                  <Text style={styles.hint}>{hint}</Text>
                </View>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Availability</Text>
              <View style={styles.row}>
                <Text style={styles.label}>{values.open ? 'Open for supply requests' : 'Not receiving supply requests'}</Text>
                <Switch accessibilityLabel="Pharmacy open for supply requests" disabled={busy} value={values.open}
                  onValueChange={(value) => change('open', value)} trackColor={{ false: '#303541', true: '#28634d' }} />
              </View>
              <Text style={styles.label}>Estimated preparation time (minutes)</Text>
              <TextInput accessibilityLabel="Preparation time in minutes" style={styles.input} keyboardType="number-pad"
                maxLength={5} editable={!busy} value={values.waitMinutes}
                onChangeText={(value) => change('waitMinutes', value.replace(/\D/g, ''))} />
              <Text style={styles.sectionTitle}>Medicine and supply inventory</Text>
              {catalogue.map((item) => (
                <View key={item.id}>
                  <Text style={styles.label}>{item.name} · {item.unit}</Text>
                  <TextInput accessibilityLabel={`${item.name} stock in ${item.unit}`} style={styles.input}
                    keyboardType="number-pad" maxLength={5} value={values.stock[item.id]} editable={!busy}
                    onChangeText={(value) => change('stock', { ...values.stock, [item.id]: value.replace(/\D/g, '') })} />
                  {values.stock[item.id] !== '' && Number(values.stock[item.id]) <= 10
                    ? <Text style={styles.hint}>{Number(values.stock[item.id]) === 0 ? 'Out of stock' : 'Low stock'} · demo threshold</Text> : null}
                </View>
              ))}
              <Text style={styles.sectionTitle}>Services available right now</Text>
              {pharmacy.services.map((service) => {
                const selected = values.services.includes(service);
                return (
                  <Pressable key={service} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}
                    disabled={busy} style={styles.service} onPress={() => change('services', selected
                      ? values.services.filter((item) => item !== service) : [...values.services, service])}>
                    <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={24} color={selected ? '#7dcfff' : '#747b89'} />
                    <Text style={styles.body}>{service}</Text>
                  </Pressable>
                );
              })}
              <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => save()}>
                <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Update demo inventory'}</Text>
              </Pressable>
              {lastSaved ? <Text style={styles.hint}>Saved: {new Date(lastSaved.savedAt).toLocaleString()} · {lastSaved.pending ? 'Cloud sync pending' : 'Synced to Supabase'}</Text> : null}
              {message ? <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text> : null}
              {lastSaved?.pending ? (
                <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => save(true)}>
                  <Text style={styles.link}>Retry cloud sync of saved update</Text>
                </Pressable>
              ) : null}
              <Text style={styles.hint}>Reopen Command Center → Pharmacies to refresh. Other devices require successful cloud sync; LoRa delivery is not connected yet.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Incoming supply requests</Text>
              <Text style={styles.body}>No hospital supply request feed connected yet.</Text>
              <Text style={styles.hint}>Request acceptance and pickup tracking will appear here once routing is connected.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Pharmacy details</Text>
              <Text style={styles.body}>{pharmacy.hours}</Text>
              <Text style={styles.hint}>Phone: {pharmacy.phone}</Text>
            </View>
          </>
        ) : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.link}>Switch role</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
