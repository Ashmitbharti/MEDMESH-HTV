import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ambulance, Building2, HandCoins } from 'lucide-react-native';
import { useMesh } from '../link/meshLink';
import { incoming } from './hospitalService';
import styles from '../navigation/Navbar.styles';
import { c } from '../medmesh-id/theme';

export default function HospitalNavbar() {
  const insets = useSafeAreaInsets();
  const { inbox } = useMesh();
  const coming = incoming(inbox, 0).filter((p) => p.phase === 'coming' || p.phase === 'enroute').length;
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: styles.screen,
          tabBarActiveTintColor: c.sky,
          tabBarInactiveTintColor: '#6b7280',
          tabBarStyle: [styles.bar, { marginBottom: Math.max(insets.bottom, 12) }],
          tabBarLabelStyle: styles.label,
          tabBarItemStyle: styles.item,
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Hospital', tabBarIcon: ({ color }) => <Building2 size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="incoming" options={{
          title: 'Incoming',
          tabBarBadge: coming || undefined,
          tabBarBadgeStyle: { backgroundColor: '#f43f5e', fontSize: 10, fontWeight: '800' },
          tabBarIcon: ({ color }) => <Ambulance size={22} color={color} strokeWidth={2.2} />,
        }} />
        <Tabs.Screen name="supplies" options={{ title: 'Supplies', tabBarIcon: ({ color }) => <HandCoins size={22} color={color} strokeWidth={2.2} /> }} />
      </Tabs>
    </View>
  );
}
