import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import {
  Check, ChevronLeft, ChevronRight, HeartPulse, TriangleAlert, Languages, MapPin, Mic, Minus, Plus, Send, Siren, Sparkles, Users,
} from 'lucide-react-native';
import s from './Report.styles';
import { c } from '../medmesh-id/theme';
import PersonCard from './PersonCard';
import LinkBanner from '../components/LinkBanner';
import { loadScene, saveScene } from './sceneService';
import { interpret } from './interpret';
import { blankPerson, CAUSES, HAZARDS, reportWire, sceneWire, triageOf, voiceWire } from './sosLogic';
import { getPosition } from '../dashboard/hazardService';
import { newId, queue } from '../dashboard/outbox';
import { mirrorSos } from '../cloud/cloudSync';
import { forId, useMesh } from '../link/meshLink';

const AUTO_SEND_S = 30; // "I'm in trouble": if the person stops responding, send what we have

// one card per person: "3 people hurt" with only one described still gets 3 cards
const padPeople = (people, n) => {
  const out = [...people];
  while (out.length < n) out.push(blankPerson(out.length));
  return out;
};

function Btn({ onPress, disabled, colors, icon: Icon, children }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [s.btn, disabled && { opacity: 0.5 }, pressed && s.pressed]}>
      <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.btnFill}>
        {Icon ? <Icon size={18} color="#fff" /> : null}
        <Text style={s.btnText}>{children}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export default function Report() {
  const [scene, setScene] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(0);
  const [idle, setIdle] = useState(0);
  const { link, inbox, outbox } = useMesh();
  const sending = useRef(false);

  useFocusEffect(useCallback(() => {
    loadScene().then((sc) => {
      if (!sc || ['cancelled', 'closed'].includes(sc.phase)) { router.replace('/'); return; }
      setScene(sc);
    });
  }, []));

  const update = useCallback(async (patch) => {
    setScene((cur) => {
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      saveScene(next);
      return next;
    });
    setIdle(0);
  }, []);

  // GPS as soon as the report opens (works offline)
  useEffect(() => {
    if (!scene || scene.loc) return;
    getPosition().then((p) => p && update((cur) => (cur.loc ? cur : { ...cur, loc: { ...p, text: '' } })));
  }, [scene, update]);

  const sendAll = useCallback(async ({ stoppedAnswering = false } = {}) => {
    if (sending.current || !scene) return;
    sending.current = true;
    const sc = { ...scene, sent: { ...scene.sent }, people: [...scene.people] };
    if (stoppedAnswering && sc.mode === 'self') {
      // they stopped answering: we can no longer assume they are responsive
      const me = sc.people[0];
      sc.people[0] = { ...me, responds: 'unknown', note: [me.note, 'stopped answering the app'].filter(Boolean).join('; ') };
    }
    const count = Math.max(sc.count, sc.people.length);
    if (count > 1 && !sc.sceneId) {
      sc.sceneId = newId();
      await queue('scene', sceneWire(sc.sceneId, count, sc.loc, sc.cause, sc.hazards, sc.vehicles), { scene: sc.id });
    }
    for (const p of sc.people) {
      if (sc.sent[p.key]) continue;
      const id = newId();
      sc.sent[p.key] = id;
      await queue('report', reportWire(id, p, { count, loc: sc.loc, sceneId: sc.sceneId, hazards: sc.hazards || [], cause: sc.cause, ai: p.fromAi ? (sc.ai?.source === 'gemini' ? 'g' : 'o') : '' }), { scene: sc.id });
      // same report into Ashmit's Supabase SOS table when there is internet (never blocks the mesh path)
      mirrorSos({ id, mode: sc.mode, person: p, loc: sc.loc, medmeshId: p.mid, summary: sc.ai?.result?.summary }).catch(() => {});
    }
    sc.phase = 'sent';
    await saveScene(sc);
    setScene(sc);
    sending.current = false;
  }, [scene]);

  // auto-send for "I'm in trouble" when the person stops interacting
  const auto = scene && scene.mode === 'self' && !['sent', 'cancelled', 'closed'].includes(scene.phase);
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => setIdle((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [auto]);
  useEffect(() => {
    if (auto && idle >= AUTO_SEND_S) sendAll({ stoppedAnswering: true });
  }, [auto, idle, sendAll]);

  if (!scene) return <SafeAreaView style={s.screen} />;
  const self = scene.mode === 'self';
  const ids = [...Object.values(scene.sent), scene.sceneId, scene.voiceId].filter(Boolean);

  async function fillFromWords() {
    setError('');
    setBusy('Understanding…');
    try {
      const out = await interpret(text);
      const r = out.result;
      const people = r.people.map((p, i) => (self && i === 0 ? { ...p, label: 'You', mid: scene.people[0].mid } : p));
      await update({
        ai: { source: out.source, via: out.via, text, language: r.language, translation: r.translation_en, summary: r.summary },
        people: padPeople(people, r.count), count: Math.max(r.count, people.length), cause: r.incident_type === 'unknown' ? '' : r.incident_type,
        loc: scene.loc || (r.location_text ? { text: r.location_text } : null),
        phase: 'where',
      });
      setOpen(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function sendWords() {
    if (!text.trim()) { setError('Type or say what is happening first.'); return; }
    const id = newId();
    await queue('voice', voiceWire(id, scene.loc, '', text.trim()), { scene: scene.id });
    await update({ voiceId: id, ai: { source: 'words', text }, phase: 'sent' });
  }

  function setCount(n) {
    const people = [...scene.people];
    while (people.length < n) people.push(blankPerson(people.length));
    update({ count: n, people: n < people.length && !people.slice(n).some((p) => p.fromAi) ? people.slice(0, n) : people });
  }

  async function cancel() {
    await update({ phase: 'cancelled' });
    router.replace('/');
  }

  async function close() {
    await update({ phase: 'closed' });
    router.replace('/');
  }

  const statusOf = (key) => {
    const id = scene.sent[key];
    if (!id) return '';
    const h = forId(inbox, id).filter((m) => m.code === 'H').pop();
    if (h) return h.f.slice(3).join('|') || h.f[1];
    const o = outbox.find((x) => x.id === id);
    return o?.status === 'acked' ? '✓✓ Received by the command centre' : o?.status === 'sent' ? '✓ Sent' : 'Saved · waiting for a node';
  };

  const worst = scene.people.some((p) => p.breathing === 'none');
  const bleeding = scene.people.some((p) => p.bleeding === 'yes');

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']} onTouchStart={() => setIdle(0)}>
      <LinearGradient colors={['rgba(244,63,94,0.20)', 'rgba(5,7,15,0)']} style={s.glow} pointerEvents="none" />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.top}>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={s.back}>
            <ChevronLeft size={18} color={c.muted} /><Text style={s.backText}>Home</Text>
          </Pressable>
          {scene.phase !== 'sent' ? (
            <Pressable accessibilityRole="button" onPress={cancel}><Text style={s.cancel}>Cancel request</Text></Pressable>
          ) : null}
        </View>

        <LinkBanner link={link} ids={ids} outbox={outbox} />

        <Text style={s.eyebrow}>{self ? 'EMERGENCY · FOR YOU' : 'EMERGENCY · SOMEONE ELSE'}</Text>

        {/* 1. own words */}
        {scene.phase === 'describe' ? (
          <>
            <Text style={s.title}>{"What's happening?"}</Text>
            <Text style={s.sub}>Say it in any language, in your own words. We fill in the form for you. You check it before it is sent.</Text>
            <View style={s.card}>
              <TextInput style={s.big} multiline value={text} onChangeText={setText} accessibilityLabel="Describe what is happening"
                placeholder={self ? 'e.g. I fell down the stairs, my leg is broken and I am alone' : 'e.g. car crash, 3 people hurt, one not responding'}
                placeholderTextColor={c.dim} />
              <View style={s.mic}><Mic size={13} color={c.dim} /><Text style={s.micText}>Tap the microphone on your keyboard to speak instead of typing.</Text></View>
              <Btn onPress={fillFromWords} disabled={!!busy || !text.trim()} colors={['#8b5cf6', '#2563eb']} icon={busy ? null : Sparkles}>
                {busy || 'Fill the form for me'}
              </Btn>
              {busy ? <ActivityIndicator color={c.violet} style={{ marginTop: 8 }} /> : null}
              <Pressable accessibilityRole="button" onPress={sendWords} style={({ pressed }) => [s.ghost, pressed && s.pressed]}>
                <Send size={16} color={c.ink} /><Text style={s.ghostText}>Just send my words now</Text>
              </Pressable>
            </View>
            {error ? <Text style={s.err}>{error}</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => update({ phase: 'where' })} style={s.link}>
              <Text style={s.linkText}>{"Skip · I'll tap the answers"}</Text>
            </Pressable>
          </>
        ) : null}

        {scene.ai && scene.ai.source !== 'words' && scene.phase !== 'describe' && scene.phase !== 'sent' ? (
          <View style={s.understood}>
            <View style={s.understoodHead}>
              {scene.ai.language && !/^(english|unknown)$/i.test(scene.ai.language) ? <Languages size={15} color={c.violet} /> : <Sparkles size={15} color={c.violet} />}
              <Text style={s.understoodTitle}>{scene.ai.source === 'gemini' ? 'Gemini filled this from your words' : 'Filled offline from your words'}</Text>
              <Text style={s.badge}>{scene.ai.source === 'gemini' ? 'GEMINI' : 'OFFLINE'}</Text>
            </View>
            {scene.ai.translation && !/^(english|unknown)$/i.test(scene.ai.language || '') ? (
              <Text style={s.understoodText}>{scene.ai.language}: “{scene.ai.translation}”</Text>
            ) : scene.ai.summary ? <Text style={s.understoodText}>{scene.ai.summary}</Text> : null}
            <Text style={s.understoodSub}>Check each answer below. Anything not mentioned is marked “Not sure”, which counts as urgent.</Text>
          </View>
        ) : null}

        {/* 2. where */}
        {scene.phase === 'where' ? (
          <>
            <Text style={s.title}>Where is help needed?</Text>
            {scene.loc?.lat != null ? (
              <View style={s.gps}>
                <MapPin size={18} color={c.green} />
                <Text style={s.gpsText}>GPS location found{'\n'}<Text style={{ color: c.muted, fontWeight: '600', fontSize: 12.5 }}>{scene.loc.lat.toFixed(5)}, {scene.loc.lon.toFixed(5)} · works offline</Text></Text>
              </View>
            ) : (
              <Text style={s.sub}>Looking for GPS… or type a landmark.</Text>
            )}
            <TextInput style={s.input} placeholder="Landmark (optional), e.g. Tim Hortons on Military Trail" placeholderTextColor={c.dim}
              value={scene.loc?.text || ''} onChangeText={(v) => update({ loc: { ...(scene.loc || {}), text: v } })} accessibilityLabel="Landmark" />
            <Btn onPress={() => update({ phase: 'what' })} colors={['#38bdf8', '#2563eb']} icon={ChevronRight}>Next</Btn>
          </>
        ) : null}

        {/* 2b. what happened + dangers */}
        {scene.phase === 'what' ? (
          <>
            <Text style={s.title}>What happened?</Text>
            <View style={[s.countRow, { gap: 8 }]}>
              {Object.entries(CAUSES).map(([k, v]) => (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: scene.cause === k }} onPress={() => update({ cause: k })}
                  style={({ pressed }) => [s.chip, scene.cause === k && s.chipOn, pressed && s.pressed]}>
                  <Text style={[s.chipText, scene.cause === k && s.segTextOn]}>{v}</Text>
                </Pressable>
              ))}
            </View>
            {scene.cause === 'crash' ? (
              <>
                <Text style={[s.qLabel, { marginTop: 18 }]}>How many vehicles?</Text>
                <View style={s.segRow}>
                  {['1', '2', '3+'].map((v) => (
                    <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: scene.vehicles === v }} onPress={() => update({ vehicles: v })}
                      style={[s.seg, scene.vehicles === v && s.segOn]}><Text style={[s.segText, scene.vehicles === v && s.segTextOn]}>{v}</Text></Pressable>
                  ))}
                </View>
              </>
            ) : null}
            <Text style={[s.qLabel, { marginTop: 18 }]}>Any danger at the scene?</Text>
            <Text style={[s.sub, { marginTop: -4, marginBottom: 8 }]}>Responders need to know before they arrive. Tap all that apply.</Text>
            <View style={s.chips}>
              {Object.entries(HAZARDS).map(([k, v]) => {
                const on = (scene.hazards || []).includes(k);
                return (
                  <Pressable key={k} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    onPress={() => update((cur) => {
                      const hz = cur.hazards || [];
                      const next = k === 'none' ? (on ? [] : ['none']) : on ? hz.filter((x) => x !== k) : [...hz.filter((x) => x !== 'none'), k];
                      return { ...cur, hazards: next };
                    })}
                    style={({ pressed }) => [s.chip, on && (k === 'none' ? s.chipOn : s.chipDanger), pressed && s.pressed, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
                    {on ? <Check size={13} color={k === 'none' ? c.sky : '#fda4af'} strokeWidth={3} /> : null}
                    <Text style={[s.chipText, on && s.segTextOn]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
            {(scene.hazards || []).some((h) => h !== 'none') ? (
              <View style={s.sceneSent}>
                <TriangleAlert size={16} color="#fda4af" />
                <Text style={s.sceneSentText}>{"Stay back if it isn't safe. Sending this report is the most helpful thing you can do."}</Text>
              </View>
            ) : null}
            <Btn onPress={() => update({ phase: 'count' })} colors={['#38bdf8', '#2563eb']} icon={ChevronRight}>{scene.cause ? 'Next' : 'Skip'}</Btn>
          </>
        ) : null}

        {/* 3. how many */}
        {scene.phase === 'count' ? (
          <>
            <Text style={s.title}>{self ? 'Is anyone else hurt with you?' : 'How many people need help?'}</Text>
            <View style={s.countRow}>
              {(self ? [[1, 'Just me'], [2, '+1'], [3, '+2'], [4, '+3']] : [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']]).map(([n, t]) => (
                <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: scene.count === n }} onPress={() => setCount(n)}
                  style={({ pressed }) => [s.countBtn, scene.count === n && s.countOn, pressed && s.pressed]}>
                  <Text style={s.countText}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel="Fewer" onPress={() => setCount(Math.max(1, scene.count - 1))} style={s.stepBtn}><Minus size={18} color={c.ink} /></Pressable>
              <Text style={s.countText}>{scene.count} {scene.count === 1 ? 'person' : 'people'}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => setCount(Math.min(30, scene.count + 1))} style={s.stepBtn}><Plus size={18} color={c.ink} /></Pressable>
            </View>
            {scene.count > 1 ? (
              <View style={s.sceneSent}>
                <Users size={16} color="#fda4af" />
                <Text style={s.sceneSentText}>A scene alert for {scene.count} people goes out first, so more than one ambulance can start moving.</Text>
              </View>
            ) : null}
            <Btn onPress={async () => {
              if (scene.count > 1 && !scene.sceneId) {
                const zid = newId();
                await queue('scene', sceneWire(zid, scene.count, scene.loc, scene.cause, scene.hazards, scene.vehicles), { scene: scene.id });
                await update((cur) => ({ ...cur, sceneId: zid, phase: 'people', people: padPeople(cur.people, cur.count) }));
              } else update((cur) => ({ ...cur, phase: 'people', people: padPeople(cur.people, cur.count) }));
            }} colors={['#38bdf8', '#2563eb']} icon={ChevronRight}>Next</Btn>
          </>
        ) : null}

        {/* 4. each person */}
        {scene.phase === 'people' || scene.phase === 'sent' ? (
          <>
            <Text style={s.title}>{scene.phase === 'sent' ? 'Help is being arranged' : self && scene.people.length === 1 ? 'About you' : 'About each person'}</Text>
            {scene.phase === 'people' && scene.people.length > 1 ? (
              <View style={s.tip}><Siren size={15} color={c.redl} /><Text style={s.tipText}>Start with whoever looks worst. “Not sure” is fine: it counts as urgent.</Text></View>
            ) : null}
            {scene.voiceId ? (
              <View style={s.understood}>
                <Text style={s.understoodTitle}>Your words were sent</Text>
                <Text style={s.understoodText}>“{scene.ai?.text}”</Text>
                <Text style={s.understoodSub}>
                  {forId(inbox, scene.voiceId).some((m) => m.code === 'A') ? '✓✓ The command centre received it and is filling in the details.' : 'Saved · sends when your phone reaches a node.'}
                </Text>
                {inbox.filter((m) => m.code === 'H' && m.f[0].startsWith(scene.voiceId)).map((m) => (
                  <Text key={m.at + m.f[0]} style={[s.understoodText, { color: '#bbf7d0' }]}>{m.f.slice(3).join('|')}</Text>
                ))}
              </View>
            ) : null}
            {!scene.voiceId ? scene.people.map((p, i) => (
              <PersonCard key={p.key} person={p} index={i} mode={scene.mode} open={open === i && scene.phase === 'people'}
                onToggle={() => setOpen(open === i ? -1 : i)} status={scene.phase === 'sent' ? statusOf(p.key) : ''}
                onChange={(np) => update((cur) => ({ ...cur, people: cur.people.map((x) => (x.key === np.key ? np : x)) }))} />
            )) : null}
            {scene.phase === 'people' && scene.people.length >= 3 ? (
              <Pressable accessibilityRole="button" style={s.restBtn} onPress={() => update((cur) => ({
                ...cur, people: cur.people.map((x, i) => (i === 0 || x.fromAi || x.walk !== 'unknown' ? x : { ...x, walk: 'yes', complaint: 'BL' })),
              }))}>
                <Text style={s.restText}>Everyone else is walking with minor injuries</Text>
              </Pressable>
            ) : null}

            {worst || bleeding ? (
              <View style={s.first}>
                <Text style={s.firstTitle}>While you wait</Text>
                {worst ? <Text style={s.firstText}>Not breathing: push hard and fast in the centre of the chest, about 2 pushes a second, until help arrives.</Text> : null}
                {bleeding ? <Text style={s.firstText}>Heavy bleeding: press firmly on the wound with a cloth and keep pressing.</Text> : null}
                {worst && scene.phase === 'sent' ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/cpr')} style={[s.ghost, { borderColor: 'rgba(244,63,94,0.6)' }]}>
                    <HeartPulse size={16} color={c.redl} /><Text style={s.ghostText}>Open the CPR coach</Text>
                  </Pressable>
                ) : null}
                {bleeding ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push('/guide?id=bleeding')} style={s.ghost}>
                    <Text style={s.ghostText}>Bleeding guide, read aloud</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {scene.phase === 'sent' ? (
              <>
                <Pressable accessibilityRole="button" style={s.addBtn} onPress={() => update((cur) => ({ ...cur, phase: 'people', people: [...cur.people, blankPerson(cur.people.length)], count: cur.count + 1 }))}>
                  <Plus size={16} color={c.ink} /><Text style={s.ghostText}>Add another person</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={close} style={s.link}><Text style={s.linkText}>Close · everyone has help</Text></Pressable>
              </>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      {scene.phase === 'people' || (auto && idle > 8 && scene.phase !== 'describe') ? (
        <View style={s.sticky} pointerEvents="box-none">
          {auto ? (
            <View style={s.autoBar}>
              <View style={[s.autoFill, { width: `${Math.min(100, (idle / AUTO_SEND_S) * 100)}%` }]} />
              <Text style={s.autoText}>
                {idle > 5 ? `No answer? Sending what we have in ${AUTO_SEND_S - idle} s · tap anywhere to keep going` : 'If you stop answering, we send automatically'}
              </Text>
            </View>
          ) : null}
          {scene.phase === 'people' && worst ? (
            <Btn onPress={async () => { await sendAll(); router.push('/cpr'); }} colors={['#be123c', '#4c0519']} icon={HeartPulse}>
              Send now & start CPR coach
            </Btn>
          ) : null}
          {scene.phase === 'people' && !worst ? (
            <Btn onPress={() => sendAll()} colors={['#e11d48', '#9f1239']} icon={HeartPulse}>
              {`Send ${scene.people.filter((p) => !scene.sent[p.key]).length > 1 ? `${scene.people.filter((p) => !scene.sent[p.key]).length} reports` : 'emergency report'}`}
              {scene.people.some((p) => triageOf(p) === 1) ? ' · urgent' : ''}
            </Btn>
          ) : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
