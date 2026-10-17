import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, Minus, PencilLine, Plus } from 'lucide-react-native';
import { c, mono } from '../medmesh-id/theme';

// Form pieces for the hospital screens: big touch targets, every choice has a list and a "Custom" way out.

export function Label({ children, tint = c.sky, style }) {
  return <Text style={[{ color: tint, fontFamily: mono, fontSize: 10.5, letterSpacing: 1.8, fontWeight: '700', marginBottom: 8 }, style]}>{children}</Text>;
}

export function Card({ children, active, tint = c.sky, style }) {
  return (
    <View style={[{ padding: 16, borderRadius: 22, backgroundColor: c.panel, borderWidth: 1, borderColor: active ? tint + 'aa' : c.line, marginTop: 14 }, style]}>
      {children}
    </View>
  );
}

export function Stepper({ label, value, onChange, min = 0, max = 999, tint = c.sky, sub, onFocus }) {
  const set = (v) => onChange(Math.max(min, Math.min(max, v)));
  const btn = (I, d, name) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${name} ${label}`} onPress={() => { onFocus?.(); set(value + d); }}
      style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line2 }, pressed && { opacity: 0.7 }]}>
      <I size={18} color={c.ink} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>{label}</Text>
        {sub ? <Text style={{ color: c.dim, fontSize: 12 }}>{sub}</Text> : null}
      </View>
      {btn(Minus, -1, 'Fewer')}
      <TextInput accessibilityLabel={label} value={String(value)} keyboardType="number-pad" onFocus={onFocus}
        onChangeText={(s) => set(Number(s.replace(/\D/g, '') || 0))}
        style={{ width: 58, height: 44, borderRadius: 14, textAlign: 'center', color: tint, fontSize: 20, fontWeight: '800', backgroundColor: '#070b17', borderWidth: 1, borderColor: tint + '55' }} />
      {btn(Plus, 1, 'More')}
    </View>
  );
}

// A dropdown with a fixed list and a "Custom…" entry that turns into a text box.
export function Dropdown({ label, value, options, onChange, placeholder = 'Choose', customLabel = 'Custom…', customPlaceholder = 'Type it', keyboardType, tint = c.sky, allowNone, format = String }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const match = options.find((o) => o.value === value);
  const shown = match ? match.label : value ? format(value) : placeholder;
  return (
    <View style={{ marginTop: 6 }}>
      {label ? <Text style={{ color: c.muted, fontSize: 12.5, fontWeight: '600', marginBottom: 6 }}>{label}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${label || placeholder}: ${shown}`} onPress={() => setOpen((v) => !v)}
        style={{ minHeight: 50, borderRadius: 16, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: '#070b17', borderWidth: 1, borderColor: open ? tint : c.line2 }}>
        <Text style={{ flex: 1, color: match || value ? c.ink : c.dim, fontSize: 15, fontWeight: '700' }}>{shown}</Text>
        <ChevronDown size={18} color={c.muted} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: 6, borderRadius: 16, backgroundColor: c.panel2, borderWidth: 1, borderColor: c.line2, overflow: 'hidden' }}>
          {allowNone ? (
            <Pressable accessibilityRole="menuitem" onPress={() => { onChange(''); setOpen(false); setCustom(false); }} style={{ padding: 13, borderBottomWidth: 1, borderColor: c.line }}>
              <Text style={{ color: c.muted, fontSize: 14.5, fontWeight: '600' }}>None</Text>
            </Pressable>
          ) : null}
          {options.map((o) => (
            <Pressable key={String(o.value)} accessibilityRole="menuitem" accessibilityLabel={o.label} onPress={() => { onChange(o.value); setOpen(false); setCustom(false); }}
              style={({ pressed }) => [{ padding: 13, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }, pressed && { backgroundColor: c.line }]}>
              <Text style={{ flex: 1, color: c.ink, fontSize: 14.5, fontWeight: '600' }}>{o.label}</Text>
              {o.value === value ? <Check size={16} color={tint} /> : null}
            </Pressable>
          ))}
          <Pressable accessibilityRole="menuitem" accessibilityLabel={customLabel} onPress={() => { setCustom(true); setOpen(false); }} style={{ padding: 13, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <PencilLine size={15} color={tint} /><Text style={{ color: tint, fontSize: 14.5, fontWeight: '700' }}>{customLabel}</Text>
          </Pressable>
        </View>
      ) : null}
      {custom ? (
        <TextInput autoFocus accessibilityLabel={`${label || 'Custom'} custom value`} placeholder={customPlaceholder} placeholderTextColor={c.dim} keyboardType={keyboardType}
          defaultValue={match ? '' : String(value || '')} onChangeText={(s) => onChange(keyboardType ? Number(s.replace(/\D/g, '') || 0) : s)}
          style={{ marginTop: 8, minHeight: 48, borderRadius: 14, paddingHorizontal: 14, color: c.ink, fontSize: 15, backgroundColor: '#070b17', borderWidth: 1, borderColor: tint + '88' }} />
      ) : null}
    </View>
  );
}

export function Chip({ on, label, onPress, tint = c.sky, icon: I }) {
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, minHeight: 40, borderRadius: 14, borderWidth: 1, borderColor: on ? tint : c.line2, backgroundColor: on ? tint + '22' : 'transparent' }, pressed && { opacity: 0.8 }]}>
      {I ? <I size={14} color={on ? tint : c.muted} /> : on ? <Check size={14} color={tint} /> : null}
      <Text style={{ color: on ? c.ink : c.muted, fontSize: 13.5, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function ago(ms, now) {
  if (!ms) return 'never';
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} h ${m % 60} min ago`;
}
