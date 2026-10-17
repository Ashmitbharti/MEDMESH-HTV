import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { catalogue } from '../pharmacy/catalogue';
import { createSupplyRequest } from './supplyService';
import SupplyRequests from './SupplyRequests';
import styles from './Supplies.styles';

export default function HospitalSupplies({ hospital }) {
  const [expanded, setExpanded] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [priority, setPriority] = useState('urgent');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const sending = useRef(false);

  async function submit() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await createSupplyRequest(hospital.hosid, quantities, priority);
      setMessage(result.message);
      setQuantities({});
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setError(error.message || 'Could not save the supply request.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pharmacy supplies</Text>
        <Text style={styles.body}>Send medicine and supply needs to Command Center. The operator assigns an available pharmacy.</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.primary}
          disabled={busy} onPress={() => setExpanded((value) => !value)}>
          <Text style={styles.primaryText}>{expanded ? 'Close request form' : 'Request medicines and supplies'}</Text>
        </Pressable>
        {expanded ? (
          <>
            <Text style={styles.hint}>Demo logistics only. Pharmacy staff must confirm product strength, suitability and dispensing requirements separately. No patient details.</Text>
            {catalogue.map((item) => (
              <View key={item.id}>
                <Text style={styles.label}>{item.name} · {item.unit}</Text>
                <TextInput accessibilityLabel={`Request ${item.name} quantity in ${item.unit}`} style={styles.input}
                  keyboardType="number-pad" maxLength={5} placeholder="0" placeholderTextColor="#777d89" editable={!busy}
                  value={quantities[item.id] || ''} onChangeText={(value) => setQuantities((current) => ({ ...current, [item.id]: value.replace(/\D/g, '') }))} />
              </View>
            ))}
            <Text style={styles.label}>Priority</Text>
            <View style={styles.row}>
              {['urgent', 'routine'].map((value) => (
                <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: priority === value }}
                  disabled={busy} style={[styles.action, priority === value && styles.selected]} onPress={() => setPriority(value)}>
                  <Text style={styles.link}>{value === 'urgent' ? 'Urgent' : 'Routine'}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>Command Center receives this request first, checks pharmacy stock, and assigns fulfilment. No pharmacy is contacted until assigned.</Text>
            <Pressable accessibilityRole="button" disabled={busy} style={styles.primary} onPress={submit}>
              <Text style={styles.primaryText}>{busy ? 'Saving request…' : 'Send to Command Center'}</Text>
            </Pressable>
          </>
        ) : null}
        {message ? <Text style={styles.hint} accessibilityLiveRegion="polite">{message}</Text> : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      </View>
      <SupplyRequests key={`${hospital.hosid}-${refreshKey}`} mode="hospital" id={hospital.hosid} />
    </>
  );
}
