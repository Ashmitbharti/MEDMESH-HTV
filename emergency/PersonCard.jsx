import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ChevronDown, ChevronUp, QrCode, Quote, Sparkles } from 'lucide-react-native';
import s from './Report.styles';
import { c } from '../medmesh-id/theme';
import { COMPLAINTS, describe, TRIAGE, triageOf } from './sosLogic';
import QrIdentification from './QrIdentification';

function Seg({ label, value, options, onChange }) {
  return (
    <View style={s.q}>
      <Text style={s.qLabel}>{label}</Text>
      <View style={s.segRow}>
        {options.map(([v, t]) => {
          const on = value === v;
          return (
            <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${label} ${t}`}
              onPress={() => onChange(v)} style={({ pressed }) => [s.seg, on && (v === 'unknown' ? s.segUnsure : s.segOn), pressed && s.pressed]}>
              <Text style={[s.segText, on && s.segTextOn]}>{t}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const YN = [['yes', 'Yes'], ['no', 'No'], ['unknown', 'Not sure']];

export default function PersonCard({ person, index, mode, open, onToggle, onChange, status }) {
  const [scanning, setScanning] = useState(false);
  const tri = triageOf(person);
  const T = TRIAGE[tri];
  const self = mode === 'self' && index === 0;
  const set = (k) => (v) => onChange({ ...person, [k]: v });
  const you = (a, b) => (self ? a : b);

  return (
    <View style={[s.person, { borderColor: T.color + '66' }]}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={s.personHead}>
        <View style={[s.triDot, { backgroundColor: T.color }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.personTitle}>{self ? 'You' : person.label ? `${person.label}` : `Person ${index + 1}`}</Text>
          <Text style={s.personSub} numberOfLines={1}>{describe(person)}</Text>
        </View>
        <View style={[s.triChip, { backgroundColor: T.color + '22', borderColor: T.color + '77' }]}>
          <Text style={[s.triText, { color: T.color }]}>{T.label.toUpperCase()}</Text>
        </View>
        {open ? <ChevronUp size={18} color={c.muted} /> : <ChevronDown size={18} color={c.muted} />}
      </Pressable>
      {status ? <Text style={s.personStatus}>{status}</Text> : null}

      {open ? (
        <View style={s.editor}>
          {person.fromAi && person.evidence ? (
            <View style={s.aiQuote}>
              <Sparkles size={12} color={c.violet} />
              <Quote size={11} color={c.violet} />
              <Text style={s.aiQuoteText} numberOfLines={2}>{person.evidence}</Text>
            </View>
          ) : null}
          <Seg label={you('Can you walk?', 'Can they walk?')} value={person.walk} options={YN} onChange={set('walk')} />
          {person.walk !== 'yes' ? (
            <>
              <Seg label={you('Your breathing?', 'Breathing?')} value={person.breathing}
                options={[['normal', 'Normal'], ['fast', 'Struggling'], ['none', 'Not breathing'], ['unknown', 'Not sure']]} onChange={set('breathing')} />
              {!self ? <Seg label="Responding to you?" value={person.responds} options={YN} onChange={set('responds')} /> : null}
              <Seg label="Heavy bleeding?" value={person.bleeding} options={YN} onChange={set('bleeding')} />
            </>
          ) : null}
          <View style={s.q}>
            <Text style={s.qLabel}>{you("What's wrong?", 'Main problem')}</Text>
            <View style={s.chips}>
              {Object.entries(COMPLAINTS).map(([k, v]) => (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: person.complaint === k }} onPress={() => set('complaint')(k)}
                  style={({ pressed }) => [s.chip, person.complaint === k && s.chipOn, pressed && s.pressed]}>
                  <Text style={[s.chipText, person.complaint === k && s.segTextOn]}>{v}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          {!self ? (
            <Seg label="Age" value={person.age_group} options={[['child', 'Child'], ['adult', 'Adult'], ['senior', 'Senior'], ['unknown', 'Not sure']]} onChange={set('age_group')} />
          ) : null}
          <View style={s.q}>
            <Text style={s.qLabel}>Anything else? (optional)</Text>
            <TextInput style={s.noteInput} placeholder={you('e.g. diabetic, can’t move my leg', 'e.g. trapped in car, pregnant')} placeholderTextColor={c.dim}
              value={person.note} onChangeText={set('note')} maxLength={60} accessibilityLabel="Note for paramedics" />
            <Pressable onPress={() => set('trapped')(!person.trapped)} accessibilityRole="checkbox" accessibilityState={{ checked: person.trapped }} style={[s.chip, { marginTop: 8, alignSelf: 'flex-start' }, person.trapped && s.chipOn]}>
              <Text style={[s.chipText, person.trapped && s.segTextOn]}>{you("I'm trapped / can't get out", 'Trapped / can’t get out')}</Text>
            </Pressable>
          </View>
          {!self ? (
            person.mid ? (
              <Text style={s.midText}>MedMesh ID attached: <Text style={{ color: c.sky, fontWeight: '800' }}>{person.mid}</Text></Text>
            ) : scanning ? (
              <QrIdentification focused busy={false} savedId={null}
                onContinue={(id) => { setScanning(false); if (id) set('mid')(id); }} />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setScanning(true)} style={s.scanBtn}>
                <QrCode size={16} color={c.sky} /><Text style={s.scanText}>Scan their MedMesh QR (optional)</Text>
              </Pressable>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
