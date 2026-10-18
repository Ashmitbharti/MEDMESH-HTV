import { confirmAction } from '../components/confirmAction';
import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { staffEmergencies, emergencyAction } from './cloudService';
import { loadHospitals } from '../command-center/hospitalService';
import { hospitals as references } from '../command-center/facilities';
import { questions } from './questions';
import styles from './EmergencyRouting.styles';

function HospitalChoice({ request, hospitals, busy, onAssign }) {
  const [selected, setSelected] = useState('');
  const [bed, setBed] = useState('general');
  return (
    <View>
      <Text style={styles.sectionTitle}>Assign a receiving hospital</Text>
      <Text style={styles.hint}>Compare reported capacity, ER wait and available care. The operator chooses the destination; these are simulated availability figures.</Text>
      <View style={styles.row}>
        {['general', 'icu'].map((type) => (
          <Pressable key={type} accessibilityRole="radio" accessibilityState={{ checked: bed === type }}
            disabled={busy} style={[styles.option, bed === type && styles.selected]} onPress={() => setBed(type)}>
            <Text style={styles.link}>{type === 'icu' ? 'ICU bed' : 'General bed'}</Text>
          </Pressable>
        ))}
      </View>
      {[...hospitals].sort((a, b) => (a.demoAvailability?.erWaitMinutes ?? Infinity) - (b.demoAvailability?.erWaitMinutes ?? Infinity)).map((hospital) => {
        const status = hospital.demoAvailability || {};
        const available = bed === 'icu' ? status.freeIcuBeds : Number.isFinite(status.freeBeds) && Number.isFinite(status.freeIcuBeds) ? status.freeBeds - status.freeIcuBeds : 0;
        const eligible = (hospital.loadedFromCloud || hospital.loadedFromDemo) && hospital.availabilityIsSimulated && status.open && available > 0;
        return (
          <Pressable key={hospital.hosid} accessibilityRole="radio" accessibilityState={{ checked: selected === hospital.hosid, disabled: !eligible || busy }}
            disabled={!eligible || busy} style={[styles.option, selected === hospital.hosid && styles.selected, !eligible && styles.disabled]}
            onPress={() => setSelected(hospital.hosid)}>
            <Text style={styles.body}>{hospital.name}</Text>
            <Text style={styles.link}>{status.freeBeds ?? '—'} free beds · {status.freeIcuBeds ?? '—'} ICU · ER {status.erWaitMinutes ?? 'Unknown'} min</Text>
            <Text style={styles.hint}>{status.open ? 'Open' : 'Closed'} · {(hospital.availableServices || hospital.services).join(' · ')}</Text>
            <Text style={styles.hint}>{hospital.statusReceivedAt ? `Reported ${new Date(hospital.statusReceivedAt).toLocaleString()}` : 'No cloud status timestamp'}{!eligible ? ' · Unavailable for this bed type' : ''}</Text>
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" disabled={busy || !selected || !hospitals.some((h) => h.hosid === selected && (h.loadedFromCloud || h.loadedFromDemo) && h.availabilityIsSimulated && h.demoAvailability?.open && (bed === 'icu' ? h.demoAvailability.freeIcuBeds : h.demoAvailability.freeBeds - h.demoAvailability.freeIcuBeds) > 0)}
        style={styles.primary} onPress={() => onAssign(request, 'assign', { hospital_id: selected, bed_type: bed }, 'Assign hospital?', 'Reserve one bed and notify this hospital?')}>
        <Text style={styles.primaryText}>Assign hospital and reserve bed</Text>
      </Pressable>
    </View>
  );
}

export default function StaffEmergencies({ mode = 'command', hospitalId }) {
  const [requests, setRequests] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [message, setMessage] = useState('Loading SOS requests…');
  const [setupSql, setSetupSql] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const refreshRef = useRef(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    let loading = false;
    async function refresh() {
      if (loading || working.current || AppState.currentState !== 'active') return;
      loading = true;
      try {
        const result = await staffEmergencies(mode, hospitalId);
        const records = mode === 'command' && !result.setupSql ? await loadHospitals({ includeLocal: false }) : [];
        if (!active) return;
        setRequests(result.requests);
        setHospitals(records);
        setMessage(result.message);
        setSetupSql(result.setupSql);
        setError('');
      } catch (error) {
        if (active) setError(error.message || 'Could not refresh emergencies.');
      } finally { loading = false; }
    }
    refreshRef.current = refresh;
    refresh();
    const timer = setInterval(refresh, 5000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { active = false; refreshRef.current = null; clearInterval(timer); subscription.remove(); };
  }, [mode, hospitalId]));

  const operate = useCallback((request, action, details, title, description) => {
    confirmAction(title, description, [
      { text: 'Go back', style: 'cancel' },
      { text: 'Confirm', onPress: async () => {
        if (working.current) return;
        working.current = true;
        setBusy(true);
        setError('');
        try {
          const saved = await emergencyAction(request, action, details);
          setRequests((current) => current.map((item) => item.id === saved.id ? saved : item));
        } catch (error) { setError(error.message || 'Could not save this action. Refresh and try again.'); }
        finally { working.current = false; setBusy(false); refreshRef.current?.(); }
      } },
    ]);
  }, []);

  const incoming = requests.filter((request) => !['closed', 'cancelled'].includes(request.status));
  return (
    <View>
      <Text style={styles.sectionTitle}>{mode === 'hospital' ? 'Incoming emergencies' : 'SOS dispatch queue'} · {incoming.length} active</Text>
      <Text style={styles.hint}>{message}</Text>
      <Text style={styles.hint}>Command Center dispatches the ambulance and assigns a receiving hospital. The hospital confirms arrival. Ambulance actions are simulated.</Text>
      {setupSql ? <Text selectable style={styles.body}>{setupSql}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => refreshRef.current?.()}><Text style={styles.link}>Refresh SOS requests and capacity</Text></Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!requests.length && !setupSql ? <Text style={styles.hint}>No SOS requests received yet.</Text> : null}
      {requests.map((request) => <EmergencyCard key={request.id} request={request} requests={requests}
        mode={mode} hospitalId={hospitalId} hospitals={hospitals} busy={busy} operate={operate} />)}
    </View>
  );
}

function EmergencyCard({ request, requests, mode, hospitalId, hospitals, busy, operate }) {

  const payload = request.payload || {};
  const terminal = ['closed', 'cancelled'].includes(request.status);
  const hospital = references.find((item) => item.hosid === request.hospital_id);
  const fix = payload.coordinates;
  return (
    <View key={request.id} style={styles.card}>
      <Text selectable style={styles.body}>{request.id}</Text>
      <Text style={styles.status}>{request.status.toUpperCase()}{request.cancellation_requested && !terminal ? ' · CANCELLATION REQUESTED' : ''}</Text>
      <Text style={styles.body}>{payload.mode === 'self' ? 'Member needs help' : 'Bystander helping someone'} · MedMesh ID: {payload.medmeshId || 'Not supplied'}</Text>
      <Text style={styles.hint}>{new Date(request.created_at).toLocaleString()}</Text>
      {Number.isFinite(fix?.latitude) && Number.isFinite(fix?.longitude) ? <Text selectable style={styles.link}>GPS: {fix.latitude.toFixed(5)}, {fix.longitude.toFixed(5)}</Text> : null}
      {(payload.answers?.complaint ? [
        { key: 'complaint', title: 'Complaint' }, { key: 'responding', title: 'Responding' },
        { key: 'breathing', title: 'Breathing' }, { key: 'heavyBleeding', title: 'Heavy bleeding' },
        { key: 'canWalk', title: 'Can walk' }, { key: 'ageGroup', title: 'Age group' },
        { key: 'note', title: 'Notes' }, { key: 'summary', title: 'Summary' },
      ] : questions).map((question) => (
        <Text key={question.key} style={styles.body}>{question.title}: {typeof payload.answers?.[question.key] === 'string' ? payload.answers[question.key] : 'Not answered'}{payload.missedQuestions?.includes(question.key) ? ' · Not confirmed' : ''}</Text>
      ))}
      {(Array.isArray(payload.conditionUpdates) ? payload.conditionUpdates : []).map((update, index) => <Text key={index} style={styles.hint}>Update: {typeof update?.text === 'string' ? update.text : 'No details'}</Text>)}
      {request.ambulance_id ? <Text style={styles.link}>{request.ambulance_id} dispatched (demo) · {new Date(request.ambulance_dispatched_at).toLocaleString()}</Text> : null}
      {hospital ? <Text style={styles.link}>Destination: {hospital.name} · {request.bed_type} bed{request.status === 'assigned' ? ' reserved' : ''}</Text> : null}
      {request.patient_received_at ? <Text style={styles.link}>Patient received · {new Date(request.patient_received_at).toLocaleString()} · Request closed</Text> : null}
      {mode === 'command' && !terminal ? request.cancellation_requested ? (
        <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => operate(request, 'cancel', {}, 'Confirm cancellation?', 'Confirm the cancellation and release any reserved hospital bed. Coordinate with the demo ambulance separately.')}><Text style={styles.primaryText}>Acknowledge cancellation</Text></Pressable>
      ) : (
        <>
          {!request.ambulance_id ? ['AMB-01', 'AMB-02'].map((unit) => {
            const occupied = requests.some((item) => item.ambulance_id === unit && !['closed', 'cancelled'].includes(item.status));
            return <Pressable key={unit} accessibilityRole="button" disabled={busy || occupied} style={[styles.primary, occupied && styles.disabled]} onPress={() => operate(request, 'dispatch', { ambulance_id: unit }, 'Record ambulance dispatch?', `${unit} will be marked dispatched in the demo. No real ambulance service will be contacted.`)}><Text style={styles.primaryText}>{occupied ? `${unit} unavailable` : `Dispatch ${unit} · demo`}</Text></Pressable>;
          }) : null}
          {request.ambulance_id && !request.hospital_id ? <HospitalChoice request={request} hospitals={hospitals} busy={busy} onAssign={(...args) => operate(...args)} /> : null}
        </>
      ) : null}
      {mode === 'hospital' && request.status === 'assigned' && !request.cancellation_requested ? (
        <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => operate(request, 'receive', { hospital_id: hospitalId }, 'Patient received?', 'Confirm the patient has arrived. This closes the SOS request; the occupied bed stays deducted.')}><Text style={styles.primaryText}>Patient received · close request</Text></Pressable>
      ) : null}
    </View>
  );
}
