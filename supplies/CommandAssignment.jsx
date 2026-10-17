import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { pharmacyCanSupply } from './supplyService';
import styles from './Supplies.styles';

export default function CommandAssignment({ request, pharmacies, busy, onAssign }) {
  const [selected, setSelected] = useState('');
  const available = pharmacies.filter((pharmacy) => pharmacyCanSupply(pharmacy, request.items));

  return (
    <View>
      <Text style={styles.sectionTitle}>{request.status === 'awaiting_assignment' ? 'Assign a pharmacy' : 'Assign or reassign pharmacy'}</Text>
      <Text style={styles.hint}>Open pharmacies with sufficient simulated stock. Stock is rechecked on assignment and reserved on pharmacy acceptance.</Text>
      {!available.length ? <Text style={styles.error}>No pharmacy can fulfil all quantities. Refresh stock or wait for availability.</Text> : null}
      {available.map((pharmacy) => (
        <Pressable key={pharmacy.id} accessibilityRole="radio" accessibilityState={{ checked: selected === pharmacy.id }}
          disabled={busy} style={[styles.request, selected === pharmacy.id && styles.selected]} onPress={() => setSelected(pharmacy.id)}>
          <Text style={styles.body}>{pharmacy.name} · {pharmacy.pharmacyCode}</Text>
          <Text style={styles.hint}>{pharmacy.address}</Text>
          <Text style={styles.hint}>Simulated stock · prep {pharmacy.pharmacyAvailability.waitMinutes ?? '—'} min · {pharmacy.loadedFromCloud ? 'database snapshot' : 'saved snapshot'}</Text>
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" disabled={busy || !available.some((item) => item.id === selected)}
        style={styles.primary} onPress={() => onAssign(selected)}>
        <Text style={styles.primaryText}>{busy ? 'Saving assignment…' : 'Assign selected pharmacy'}</Text>
      </Pressable>
    </View>
  );
}
