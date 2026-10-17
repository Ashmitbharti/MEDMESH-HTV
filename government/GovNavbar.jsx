import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChartColumn, Map as MapIcon, UserRoundSearch } from 'lucide-react-native';
import styles from '../navigation/Navbar.styles';
import { c } from '../medmesh-id/theme';

export default function GovNavbar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Tabs
        initialRouteName="index"
        backBehavior="history"
        screenOptions={{
          headerShown: false,
          sceneStyle: styles.screen,
          tabBarActiveTintColor: c.violet,
          tabBarInactiveTintColor: '#6b7280',
          tabBarStyle: [styles.bar, { marginBottom: Math.max(insets.bottom, 12) }],
          tabBarLabelStyle: styles.label,
          tabBarItemStyle: styles.item,
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Overview', tabBarIcon: ({ color }) => <MapIcon size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="analysis" options={{ title: 'Analysis', tabBarIcon: ({ color }) => <ChartColumn size={22} color={color} strokeWidth={2.2} /> }} />
        <Tabs.Screen name="watchlist" options={{ title: 'Watchlist', tabBarIcon: ({ color }) => <UserRoundSearch size={22} color={color} strokeWidth={2.2} /> }} />
      </Tabs>
    </View>
  );
}
