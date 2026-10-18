import RoleSwitch from '../components/RoleSwitch';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import StaffEmergencies from '../emergency/StaffEmergencies';
import styles from '../hospital/Hospital.styles';

export default function CommandEmergencies() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}><RoleSwitch />
        <Text style={styles.eyebrow}>COMMAND CENTER</Text>
        <Text style={styles.title}>Emergency coordination</Text>
        <StaffEmergencies />
      </ScrollView>
    </SafeAreaView>
  );
}
