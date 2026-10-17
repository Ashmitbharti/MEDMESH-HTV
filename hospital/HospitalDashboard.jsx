import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { hospitals } from '../command-center/facilities';
import { loadHospitals } from '../command-center/hospitalService';
import { readHospitalUpdates, saveHospitalAvailability, syncHospitalAvailability } from './hospitalStore';
import styles from './Hospital.styles';

function initialValues(hospital) {
  const status = hospital.demoAvailability || {};
  return {
    freeBeds: String(status.freeBeds ?? ''),
    freeIcuBeds: String(status.freeIcuBeds ?? ''),
    erWaitMinutes: String(status.erWaitMinutes ?? ''),
    open: status.open ?? true,
    services: hospital.availableServices || hospital.services,
  };
}

export default function HospitalDashboard() {
  const { hosid } = useLocalSearchParams();
  const id = typeof hosid === 'string' ? hosid : '';
  const known = hospitals.find((item) => item.hosid === id);
  const [hospital, setHospital] = useState(known || null);
  const [values, setValues] = useState(known ? initialValues(known) : null);
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
    Promise.all([loadHospitals(), readHospitalUpdates()]).then(([records, local]) => {
      if (!active) return;
      const record = records.find((item) => item.hosid === id);
      if (!record) throw new Error('No hospital found for this HosID.');
      setHospital(record);
      setValues(initialValues(record));
      setLastSaved(local[id] || null);
      setMessage(record.loadedFromCloud ? 'Hospital details loaded from Supabase.' : 'Using saved hospital details.');
    }).catch((error) => {
      if (active) setError(error.message || 'Could not load this hospital.');
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
    setMessage('Saving demo availability…');
    try {
      const result = retry
        ? await syncHospitalAvailability(hospital.hosid, lastSaved)
        : await saveHospitalAvailability(hospital, values);
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

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <Text style={styles.eyebrow}>HOSPITAL DASHBOARD</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace('/hospital')}>
            <Text style={styles.link}>Change hospital</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{hospital?.name || 'Hospital'}</Text>
        {loading ? <Text style={styles.hint}>Loading hospital details…</Text> : null}
        {!loading && hospital && values ? (
          <>
            <Text style={styles.description}>HosID {hospital.hospitalCode} · {hospital.address}</Text>
            <View style={styles.banner}>
              <Ionicons name="flask-outline" size={22} color="#c5a3ff" />
              <Text style={styles.bannerText}>Demo workspace · all availability entered here is simulated.</Text>
            </View>
            <View style={styles.stats}>
              {[
                ['Total beds', `${hospital.capacity.beds}`, hospital.capacity.simulated ? 'Simulated capacity' : 'Publicly listed; year unknown'],
                ['Free beds', values.freeBeds || '—', 'Simulated'],
                ['Free ICU beds', values.freeIcuBeds || '—', 'Included in free beds'],
              ].map(([label, value, hint]) => (
                <View key={label} style={styles.stat}>
                  <Text style={styles.hint}>{label}</Text>
                  <Text style={styles.statValue}>{value}</Text>
                  <Text style={styles.hint}>{hint}</Text>
                </View>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Capacity and availability</Text>
              <View style={styles.row}>
                <Text style={styles.label}>{values.open ? 'Open to receive patients' : 'Not receiving patients'}</Text>
                <Switch accessibilityLabel="Hospital open to receive patients" disabled={busy} value={values.open}
                  onValueChange={(value) => change('open', value)} trackColor={{ false: '#303541', true: '#28634d' }} />
              </View>
              {[
                ['freeBeds', 'Total free beds, including ICU'],
                ['freeIcuBeds', 'Free ICU beds'],
                ['erWaitMinutes', 'Estimated ER wait (minutes)'],
              ].map(([key, label]) => (
                <View key={key}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput accessibilityLabel={label} style={styles.input} keyboardType="number-pad" maxLength={5}
                    value={values[key]} editable={!busy} onChangeText={(value) => change(key, value.replace(/\D/g, ''))} />
                </View>
              ))}
              <Text style={styles.sectionTitle}>Care available right now</Text>
              {hospital.services.map((service) => {
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
                <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Update demo availability'}</Text>
              </Pressable>
              {lastSaved ? <Text style={styles.hint}>Saved: {new Date(lastSaved.savedAt).toLocaleString()} · {lastSaved.pending ? 'Cloud sync pending' : 'Synced to Supabase'}</Text> : null}
              {message ? <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text> : null}
              {lastSaved?.pending ? (
                <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => save(true)}>
                  <Text style={styles.link}>Retry cloud sync of saved update</Text>
                </Pressable>
              ) : null}
              <Text style={styles.hint}>Reopen Command Center → Hospitals on this phone to see local edits. Other devices need a successful cloud sync or a future mesh connection.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Incoming emergencies</Text>
              <Text style={styles.body}>No emergency request feed connected yet.</Text>
              <Text style={styles.hint}>Assignments and patient arrival tracking will appear here once Command Center routing is connected.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Pharmacy supplies</Text>
              <Text style={styles.body}>Supply requests are not connected yet.</Text>
              <Text style={styles.hint}>Phone: {hospital.phone}</Text>
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
