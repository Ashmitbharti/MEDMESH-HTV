import RoleSwitch from '../components/RoleSwitch';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import SupplyRequests from '../supplies/SupplyRequests';
import styles from '../hospital/Hospital.styles';

export default function CommandSupplies() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}><RoleSwitch />
        <Text style={styles.eyebrow}>COMMAND CENTER</Text>
        <Text style={styles.title}>Supply coordination</Text>
        <Text style={styles.description}>Review hospital needs, check pharmacy availability, and assign fulfilment.</Text>
        <Text style={styles.hint}>Hospital requests come here first. Pharmacy approval routes the order directly to the hospital and closes it.</Text>
        <SupplyRequests mode="command" />
      </ScrollView>
    </SafeAreaView>
  );
}
