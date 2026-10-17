import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ban, Check, Plus, X } from 'lucide-react-native';
import styles from './MedMeshID.styles';
import { c } from './theme';

// Chips for list answers (allergies, conditions, medications). Stores a comma-separated string so the
// Supabase columns and command-centre sync stay unchanged. "None" is an explicit answer, not a blank.
const split = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function TagInput({ value, onChange, suggestions = [], placeholder, noneLabel = 'None', accessibilityLabel }) {
  const [text, setText] = useState('');
  const items = split(value);
  const none = items.length === 1 && /^none$/i.test(items[0]);
  const chosen = none ? [] : items;
  const has = (s) => chosen.some((x) => x.toLowerCase() === s.toLowerCase());

  const set = (list) => onChange(list.join(', '));
  const add = (raw) => {
    const v = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (!v || has(v)) { setText(''); return; }
    set([...chosen, v]);
    setText('');
  };
  const remove = (v) => set(chosen.filter((x) => x !== v));

  return (
    <View>
      {chosen.length ? (
        <View style={styles.tagRow}>
          {chosen.map((t) => (
            <View key={t} style={styles.tag}>
              <Text style={styles.tagText}>{t}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${t}`} hitSlop={8} onPress={() => remove(t)}>
                <X size={13} color="#bae6fd" strokeWidth={2.6} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.tagInputRow}>
        <TextInput
          style={[styles.input, { flex: 1, minWidth: 0 }]}
          accessibilityLabel={accessibilityLabel}
          placeholder={placeholder}
          placeholderTextColor={c.dim}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => add(text)}
          blurOnSubmit={false}
          returnKeyType="done"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add"
          disabled={!text.trim()}
          style={({ pressed }) => [styles.tagAdd, !text.trim() && { opacity: 0.45 }, pressed && styles.pressed]}
          onPress={() => add(text)}
        >
          <Plus size={20} color="#fff" strokeWidth={2.6} />
        </Pressable>
      </View>

      <Text style={styles.tagHint}>COMMON · TAP TO ADD</Text>
      <View style={styles.options}>
        {suggestions.filter((s) => !has(s)).map((s) => (
          <Pressable key={s} accessibilityRole="button" accessibilityLabel={`Add ${s}`} style={({ pressed }) => [styles.suggestChip, pressed && styles.pressed]} onPress={() => add(s)}>
            <Plus size={12} color={c.muted} strokeWidth={2.6} />
            <Text style={styles.suggestText}>{s}</Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: none }}
          style={({ pressed }) => [styles.suggestChip, none && styles.selectedOption, pressed && styles.pressed]}
          onPress={() => onChange(none ? '' : 'None')}
        >
          {none ? <Check size={12} color={c.sky} strokeWidth={3} /> : <Ban size={12} color={c.muted} />}
          <Text style={[styles.suggestText, none && styles.optionTextOn]}>{noneLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}
