import { Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../auth/AuthContext';

export default function RoleSwitch() {
  const { switchRole } = useAuth();
  return <Pressable accessibilityRole="button" onPress={async () => { await switchRole(); router.replace('/welcome'); }} style={{ paddingVertical: 12 }}>
    <Text style={{ color: '#7dd3fc', fontWeight: '700' }}>Switch role</Text>
  </Pressable>;
}
