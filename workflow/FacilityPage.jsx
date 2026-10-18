import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { hospitals, pharmacies } from '../command-center/facilities';
import StaffEmergencies from '../emergency/StaffEmergencies';
import HospitalSupplies from '../supplies/HospitalSupplies';
import SupplyRequests from '../supplies/SupplyRequests';
import RoleSwitch from '../components/RoleSwitch';
import styles from '../hospital/Hospital.styles';

export default function FacilityPage({ kind }) {
  const { account } = useAuth();
  const h = hospitals.find((x) => x.hosid === account?.facilityId || x.name === account?.name);
  const p = pharmacies.find((x) => x.id === account?.facilityId || x.name === account?.name);
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <RoleSwitch />
      <Text style={styles.title}>{kind === 'pharmacy' ? p?.name : h?.name}</Text>
      {account?.mode === 'demo' ? <Text style={styles.hint}>Demo shared across roles on this device.</Text> : null}
      {kind === 'incoming' && h ? <StaffEmergencies mode="hospital" hospitalId={h.hosid} /> : null}
      {kind === 'supplies' && h ? <HospitalSupplies hospital={h} /> : null}
      {kind === 'pharmacy' && p ? <SupplyRequests mode="pharmacy" id={p.id} /> : null}
      {!(kind === 'pharmacy' ? p : h) ? <Text style={styles.error}>Choose your facility using its HosID or PharmID at entry.</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}
