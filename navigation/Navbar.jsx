import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { Activity, House, IdCard, Pill } from 'lucide-react-native';
import { isOpen, loadScene } from '../emergency/sceneService';
import { useMesh } from '../link/meshLink';
import styles from './Navbar.styles';
import { c } from '../medmesh-id/theme';

export default function Navbar() {
  const insets = useSafeAreaInsets();
  const { inbox, outbox } = useMesh();
  const [active, setActive] = useState(false);
  useEffect(() => { loadScene().then((x) => setActive(isOpen(x) && x.phase === 'sent')); }, [inbox.length, outbox.length]);

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
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <House size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="status" options={{
          title: 'Status',
          tabBarBadge: active ? '' : undefined,
          tabBarBadgeStyle: { backgroundColor: '#f43f5e', minWidth: 10, maxHeight: 10, borderRadius: 5, marginTop: 4 },
          tabBarIcon: ({ color }) => <Activity size={22} color={color} strokeWidth={2.2} />,
        }} />
        <Tabs.Screen name="medicine" options={{ title: 'Supplies', tabBarIcon: ({ color }) => <Pill size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="profile" options={{ title: 'My ID', tabBarIcon: ({ color }) => <IdCard size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="sos" options={{ href: null, tabBarStyle: { display: 'none' } }} />
        <Tabs.Screen name="safe" options={{ href: null }} />
        <Tabs.Screen name="guides" options={{ href: null }} />
        <Tabs.Screen name="guide" options={{ href: null }} />
        <Tabs.Screen name="road" options={{ href: null }} />
        <Tabs.Screen name="cpr" options={{ href: null, tabBarStyle: { display: 'none' } }} />
      </Tabs>
    </View>
  );
}
