import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState, View } from 'react-native';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { staffEmergencies } from '../emergency/cloudService';
import { hospitals } from '../command-center/facilities';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ambulance, Building2, HandCoins } from 'lucide-react-native';
import { useMesh } from '../link/meshLink';
import { incoming } from './hospitalService';
import styles from '../navigation/Navbar.styles';
import { c } from '../medmesh-id/theme';

export default function HospitalNavbar() {
  const insets = useSafeAreaInsets();
  const { inbox } = useMesh();
  const { account } = useAuth();
  const hospitalId = account?.facilityId || hospitals.find((h) => h.name === account?.name)?.hosid;
  const [cloud, setCloud] = useState({ hospitalId: '', count: 0 });
  useEffect(() => {
    let active = true;
    let loading = false;
    async function refresh() {
      if (!hospitalId || loading || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      loading = true;
      try {
        const result = await staffEmergencies('hospital', hospitalId);
        if (active) setCloud({ hospitalId, count: result.requests.filter((r) => !['closed', 'cancelled'].includes(r.status)).length });
      } catch { /* The Incoming screen displays access and connection errors. */ }
      finally { loading = false; }
    }
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [hospitalId, account?.mode]);
  const coming = (cloud.hospitalId === hospitalId ? cloud.count : 0) + incoming(inbox, 0).filter((p) => p.phase === 'coming' || p.phase === 'enroute').length;
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
