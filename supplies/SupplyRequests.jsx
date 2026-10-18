import { confirmAction } from '../components/confirmAction';
import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { hospitals, pharmacies } from '../command-center/facilities';
import { catalogue } from '../pharmacy/catalogue';
import { assignSupplyRequest, loadSupplyRequests, sendSupplyRequest, updateSupplyRequest } from './supplyService';
import { loadPharmacies } from '../command-center/pharmacyService';
import CommandAssignment from './CommandAssignment';
import styles from './Supplies.styles';

export default function SupplyRequests({ mode, id, onStockChanged }) {
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pharmacyOptions, setPharmacyOptions] = useState([]);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    const [result, options] = await Promise.all([
      loadSupplyRequests(mode, id),
      mode === 'command' ? loadPharmacies() : Promise.resolve([]),
    ]);
    return { ...result, options };
  }, [mode, id]);

  useFocusEffect(useCallback(() => {
    let active = true;
    let loading = false;
    async function load() {
      if (loading || pending.current || AppState.currentState === 'background') return;
      loading = true;
      try {
        const result = await refresh();
        if (active) { setRequests(result.requests); setMessage(result.message); setPharmacyOptions(result.options); }
      } catch { if (active) setError('Could not load saved supply requests.'); }
      finally { loading = false; }
    }
    load();
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [refresh]));

  async function act(request, status, pharmacyId) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (status === 'retry') {
        const result = await sendSupplyRequest(request);
        setRequests((current) => [result.request, ...current.filter((item) => item.id !== request.id)]);
        setMessage(result.message);
      } else if (status === 'refresh') {
        const result = await refresh();
        setRequests(result.requests);
        setMessage(result.message);
        setPharmacyOptions(result.options);
      } else if (status === 'assign') {
        const saved = await assignSupplyRequest(request, pharmacyId);
        setRequests((current) => current.map((item) => item.id === saved.id ? saved : item));
        setMessage('Assignment saved. The selected pharmacy can refresh its inbox to receive it.');
      } else {
        const saved = await updateSupplyRequest(request, status);
        setRequests((current) => current.map((item) => item.id === saved.id ? saved : item));
        setMessage(status === 'accepted' ? 'Approved, routed directly to the hospital, and closed.' : status === 'closed'
          ? 'Hospital receipt confirmed and request closed. Command Center and pharmacy can refresh to see it.'
          : 'Pharmacy status saved to Supabase. Hospital can refresh to see it.');
        if (status === 'accepted') onStockChanged?.(saved.items);
      }
    } catch (error) {
      setError(error.message || 'Status was not confirmed. Refresh and try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>{mode === 'hospital' ? 'Your supply requests' : mode === 'command' ? 'Hospital supply requests' : 'Assigned supply requests'}</Text>
      <Text style={styles.hint}>Hospital → Command Center → pharmacy approval → hospital. Requests refresh while this screen is open.</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => act(null, 'refresh')}>
        <Text style={styles.link}>{busy ? 'Working…' : 'Refresh requests'}</Text>
      </Pressable>
      {!requests.length ? <Text style={styles.body}>No saved supply requests.</Text> : null}
      {requests.map((request) => (
        <View key={request.id} style={styles.request}>
          <Text style={styles.body}>{hospitals.find((item) => item.hosid === request.hospital_id)?.name || request.hospital_id}</Text>
          <Text style={styles.hint}>{request.pharmacy_id
            ? `Assigned: ${pharmacies.find((item) => item.id === request.pharmacy_id)?.name || request.pharmacy_id}`
            : 'Command Center has not assigned a pharmacy yet.'}</Text>
          <Text style={styles.link}>{request.pending ? 'Saved locally · not confirmed sent' : request.status === 'closed' ? (request.hospital_received_at ? 'Received by hospital · closed' : 'Approved for hospital · closed') : request.status.replaceAll('_', ' ')} · {request.priority}</Text>
          {catalogue.filter((item) => request.items[item.id]).map((item) => (
            <Text key={item.id} style={styles.hint}>{item.name}: {request.items[item.id]} {item.unit}</Text>
          ))}
          <Text style={styles.hint}>{new Date(request.created_at).toLocaleString()} · {request.id}</Text>
          {request.status === 'accepted' || request.status === 'ready' ? <Text style={styles.hint}>Stock reserved by pharmacy. Pickup is not yet confirmed.</Text> : null}
          {request.status === 'assigned' ? <Text style={styles.hint}>Awaiting acceptance from the assigned pharmacy.</Text> : null}
          {request.status === 'declined' ? <Text style={styles.hint}>Pharmacy declined. Command Center can assign another pharmacy.</Text> : null}
          {request.status === 'collected' ? <Text style={styles.hint}>Picked up from pharmacy · awaiting hospital receipt.</Text> : null}
          {request.hospital_received_at ? <Text style={styles.hint}>Hospital received: {new Date(request.hospital_received_at).toLocaleString()}</Text> : null}
          {request.closed_at ? <Text style={styles.hint}>Closed: {new Date(request.closed_at).toLocaleString()}</Text> : null}
          {mode === 'hospital' && !request.pending && request.status === 'collected' ? (
            <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={() => confirmAction(
              'Confirm hospital receipt?',
              'Confirm staff have received all listed supplies at this hospital. This will close the request.',
              [
                { text: 'Not yet', style: 'cancel' },
                { text: 'Received and close', onPress: () => act(request, 'closed') },
              ],
            )}>
              <Text style={styles.primaryText}>Received by hospital · close request</Text>
            </Pressable>
          ) : null}
          {request.assigned_at ? <Text style={styles.hint}>Assigned by Command Center: {new Date(request.assigned_at).toLocaleString()} · assignment {request.assignment_version}</Text> : null}
          {mode === 'command' && !request.pending && ['awaiting_assignment', 'assigned', 'declined'].includes(request.status) ? (
            <CommandAssignment key={`${request.id}-${request.assignment_version}`} request={request}
              pharmacies={pharmacyOptions} busy={busy} onAssign={(pharmacyId) => act(request, 'assign', pharmacyId)} />
          ) : null}
          {request.pending && mode === 'hospital' ? (
            <Pressable accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => act(request, 'retry')}>
              <Text style={styles.link}>Retry sending saved request</Text>
            </Pressable>
          ) : null}
          {mode === 'pharmacy' && !request.pending ? (
            <View style={styles.row}>
              {(request.status === 'assigned' ? ['accepted', 'declined'] : request.status === 'accepted' ? ['ready'] : request.status === 'ready' ? ['collected'] : []).map((status) => (
                <Pressable key={status} accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => act(request, status)}>
                  <Text style={styles.link}>{({ accepted: 'Approve → hospital → close', declined: 'Decline', ready: 'Mark ready', collected: 'Confirm collected' })[status]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
      {message ? <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}
