import { ActivityIndicator, Text, View } from 'react-native';
import { CloudCheck, CloudOff } from 'lucide-react-native';
import { c } from '../medmesh-id/theme';

// One line under a send button: did the same update also reach Ashmit's Supabase database?
export default function CloudLine({ state }) {
  if (!state) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
      {state.busy ? <ActivityIndicator size="small" color={c.sky} /> : state.ok ? <CloudCheck size={14} color={c.green} /> : <CloudOff size={14} color={c.dim} />}
      <Text style={{ color: state.ok ? '#bbf7d0' : c.dim, fontSize: 12, flex: 1 }}>{state.busy ? 'Saving to Supabase…' : state.text}</Text>
    </View>
  );
}
