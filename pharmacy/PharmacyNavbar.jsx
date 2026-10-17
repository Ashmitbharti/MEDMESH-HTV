import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inbox, PillBottle, Radar } from 'lucide-react-native';
import { useMesh } from '../link/meshLink';
import { usePharmacy } from './PharmacyContext';
import { loadActs, requests } from './pharmacyService';
import styles from '../navigation/Navbar.styles';
import { c } from '../medmesh-id/theme';

export default function PharmacyNavbar() {
  const insets = useSafeAreaInsets();
  const { inbox } = useMesh();
  const { pharmacy } = usePharmacy() || {};
  const [acts, setActs] = useState({});
  useEffect(() => { if (pharmacy) loadActs(pharmacy.id).then(setActs); }, [pharmacy, inbox.length]);
  const open = pharmacy ? requests(inbox, pharmacy.id, 0).filter((r) => r.phase === 'asked' && !acts[r.id]?.answer).length : 0;
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
        <Tabs.Screen name="index" options={{
          title: 'Requests',
          tabBarBadge: open || undefined,
          tabBarBadgeStyle: { backgroundColor: '#f43f5e', fontSize: 10, fontWeight: '800' },
          tabBarIcon: ({ color }) => <Inbox size={22} color={color} strokeWidth={2.2} />,
        }} />
        <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: ({ color }) => <PillBottle size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="nearby" options={{ title: 'Nearby', tabBarIcon: ({ color }) => <Radar size={22} color={color} strokeWidth={2.2} /> }} />
      </Tabs>
    </View>
  );
}
