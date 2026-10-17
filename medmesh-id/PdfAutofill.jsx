import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  Check, CircleAlert, FileText, FileUp, Image as ImageIcon, Minus, Plus, Quote, RefreshCw, ShieldCheck, Sparkles, X,
} from 'lucide-react-native';
import styles from './MedMeshID.styles';
import r from './ReportReview.styles';
import { c } from './theme';
import { readReport } from './reportService';
import { applyProposals, buildProposals, FIELD_LABEL, split } from './reportDiff';

const TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX = 8 * 1024 * 1024;
const STAGES = ['Reading the document', 'Finding allergies, conditions and medications', 'Checking flagged results', 'Comparing with your profile'];

// The text-rules fallback (no Gemini key) returns form fields only; shape them like Gemini's output so the
// same review screen works. These items have no quote, which the review screen says plainly.
function fromFormDetails(d) {
  const items = (v) => split(v).filter((x) => !/^none$/i.test(x));
  return {
    patient: { name: d.name || '', age: /^\d+$/.test(d.age || '') ? Number(d.age) : null, sex: d.gender || '', blood_group: d.blood || '' },
    allergies: items(d.allergies).map((substance) => ({ substance })),
    conditions: items(d.conditions).map((name) => ({ name, status: 'active' })),
    medications: items(d.medications).map((name) => ({ name })),
    lab_results: [], devices: [],
  };
}

function KindBadge({ kind, flag }) {
  const map = {
    add: { t: 'NEW', col: c.green, I: Plus },
    set: { t: 'FILL', col: c.sky, I: Plus },
    replace: { t: 'UPDATE', col: c.amber, I: RefreshCw },
    remove: { t: 'REMOVE?', col: c.redl, I: Minus },
  };
  const m = flag ? { t: flag.toUpperCase(), col: flag === 'critical' ? c.red : c.amber, I: CircleAlert } : map[kind];
  return (
    <View style={[r.badge, { borderColor: m.col + '66', backgroundColor: m.col + '14' }]}>
      <m.I size={10} color={m.col} strokeWidth={3} />
      <Text style={[r.badgeText, { color: m.col }]}>{m.t}</Text>
    </View>
  );
}

function ProposalRow({ p, onToggle }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: p.accepted }}
      accessibilityLabel={`${p.kind} ${p.title}`}
      onPress={onToggle}
      style={({ pressed }) => [r.row, p.accepted && r.rowOn, pressed && styles.pressed]}
    >
      <View style={[r.check, p.accepted && r.checkOn]}>
        {p.accepted ? <Check size={13} color="#fff" strokeWidth={3.2} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <View style={r.rowHead}>
          <Text style={[r.rowTitle, p.kind === 'remove' && r.strike]} numberOfLines={2}>{p.title}</Text>
          <KindBadge kind={p.kind} flag={p.flag} />
        </View>
        {p.note ? <Text style={r.note}>{p.note}</Text> : null}
        {p.evidence ? (
          <View style={r.quote}>
            <Quote size={11} color={c.violet} />
            <Text style={r.quoteText} numberOfLines={3}>{p.evidence}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Scanning() {
  const [stage, setStage] = useState(0);
  const [bar] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(bar, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    loop.start();
    const t = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 2600);
    return () => { loop.stop(); clearInterval(t); };
  }, [bar]);
  return (
    <View style={r.scan} accessibilityLiveRegion="polite">
      <View style={r.scanTrack}>
        <Animated.View style={[r.scanBar, { transform: [{ translateX: bar.interpolate({ inputRange: [0, 1], outputRange: [-120, 320] }) }] }]} />
      </View>
      {STAGES.map((s, i) => (
        <View key={s} style={r.stage}>
          {i < stage ? <Check size={13} color={c.green} strokeWidth={3} /> : <View style={[r.dot, i === stage && r.dotOn]} />}
          <Text style={[r.stageText, i <= stage && { color: c.ink }]}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

export default function PdfAutofill({ details, mode = 'create', onApply, preview }) {
  const [file, setFile] = useState(null);
  // { proposals, source, model, docType, date }. `preview` (web ?demo=report) opens the review with sample data.
  const [result, setResult] = useState(() => (preview ? { ...preview, proposals: buildProposals(preview.extracted, details) } : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const picking = useRef(false);
  const update = mode === 'update';

  async function choose() {
    if (picking.current) return;
    picking.current = true;
    setError('');
    setMessage('');
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: TYPES, multiple: false, copyToCacheDirectory: true, base64: false });
      if (res.canceled) return;
      const asset = res.assets[0];
      const type = asset.mimeType || asset.file?.type || '';
      if (type && !TYPES.includes(type)) throw new Error('Choose a PDF or a photo (JPG, PNG or WebP) of your report.');
      if (!asset.size || asset.size > MAX) throw new Error('Choose a non-empty file smaller than 8 MB.');
      setFile(asset);
      setResult(null);
    } catch (e) {
      setError(e.message || 'Could not select the file. Please try again.');
    } finally {
      picking.current = false;
    }
  }

  async function read() {
    setLoading(true);
    setError('');
    try {
      const out = await readReport(file);
      const extracted = out.extracted || fromFormDetails(out.details || {});
      const proposals = buildProposals(extracted, details);
      setResult({ proposals, source: out.source, model: out.model, docType: extracted.document_type, date: extracted.report_date });
    } catch (e) {
      setError(e.message || 'Could not read the report. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function toggle(id) {
    setResult((cur) => ({ ...cur, proposals: cur.proposals.map((p) => (p.id === id ? { ...p, accepted: !p.accepted } : p)) }));
  }

  function reset() {
    setResult(null);
    setFile(null);
    setError('');
  }

  function apply() {
    const chosen = result.proposals.filter((p) => p.accepted);
    onApply(applyProposals(details, result.proposals), { count: chosen.length, date: result.date, docType: result.docType });
    reset();
    setMessage(chosen.length
      ? `${chosen.length} change${chosen.length > 1 ? 's' : ''} added. ${update ? 'Review below, then save to update your ID.' : 'Check each answer as you go.'}`
      : 'Nothing was changed.');
  }

  const accepted = result ? result.proposals.filter((p) => p.accepted).length : 0;
  const groups = result ? [...new Set(result.proposals.map((p) => FIELD_LABEL[p.field]))] : [];
  const isImage = file && /^image\//.test(file.mimeType || file.file?.type || '');

  return (
    <View style={styles.uploadCard}>
      {!file && !result ? (
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.uploadButton, pressed && styles.pressed]}
          onPress={choose}
        >
          <View style={styles.uploadIcon}>
            {update ? <RefreshCw size={20} color={c.sky} strokeWidth={2.2} /> : <FileUp size={20} color={c.sky} strokeWidth={2.2} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.uploadTitle}>{update ? 'Update from a new report' : 'Fill in from a medical report'}</Text>
            <Text style={styles.uploadSub}>PDF or photo · you approve every change</Text>
          </View>
          <Sparkles size={16} color={c.violet} />
        </Pressable>
      ) : null}

      {file && !result ? (
        <View>
          <View style={r.fileRow}>
            <View style={r.fileIcon}>
              {isImage ? <ImageIcon size={18} color={c.sky} /> : <FileText size={18} color={c.sky} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewValue} numberOfLines={1}>{file.name}</Text>
              <Text style={styles.uploadSub}>{(file.size / 1024 / 1024).toFixed(1)} MB</Text>
            </View>
            {!loading ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Remove file" onPress={reset} hitSlop={10}>
                <X size={18} color={c.dim} />
              </Pressable>
            ) : null}
          </View>
          {loading ? <Scanning /> : (
            <>
              <View style={r.privacy}>
                <ShieldCheck size={14} color={c.green} />
                <Text style={r.privacyText}>
                  Gemini reads the report and copies out what it states, with a quote for each item. Nothing is diagnosed,
                  nothing changes until you approve it, and the report is not stored.
                </Text>
              </View>
              <Pressable accessibilityRole="button" style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]} onPress={read}>
                <Text style={styles.nextText}>Read report</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}

      {result ? (
        <View>
          <View style={r.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewTitle}>
                {result.proposals.length ? `${result.proposals.length} change${result.proposals.length > 1 ? 's' : ''} found` : 'Already up to date'}
              </Text>
              <Text style={styles.uploadSub}>
                {[result.docType, result.date].filter(Boolean).join(' · ') || 'Medical report'}
              </Text>
            </View>
            <View style={r.source}>
              <Sparkles size={11} color={c.violet} />
              <Text style={r.sourceText}>{result.source === 'gemini' ? 'Read by Gemini' : 'Text rules'}</Text>
            </View>
          </View>

          {result.proposals.length ? (
            <Text style={styles.hint}>Tap to accept or skip each one. Removals and unconfirmed items start unticked.</Text>
          ) : (
            <Text style={styles.hint}>Your profile already includes everything this report states.</Text>
          )}
          {result.source !== 'gemini' && result.proposals.length ? (
            <Text style={[styles.hint, { color: c.amber }]}>Read with basic text rules, so there are no quotes. Check each item.</Text>
          ) : null}

          {groups.map((g) => (
            <View key={g} style={r.group}>
              <Text style={styles.section}>{g.toUpperCase()}</Text>
              {result.proposals.filter((p) => FIELD_LABEL[p.field] === g).map((p) => (
                <ProposalRow key={p.id} p={p} onToggle={() => toggle(p.id)} />
              ))}
            </View>
          ))}

          {result.proposals.some((p) => p.field === 'labs') ? (
            <Text style={styles.hint}>Flagged results are shared with responders as written. MedMesh does not interpret them.</Text>
          ) : null}

          <View style={styles.navRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Discard" style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={reset}>
              <X size={18} color={c.ink} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!accepted}
              style={({ pressed }) => [styles.nextButton, r.applyBtn, !accepted && { opacity: 0.5 }, pressed && styles.pressed]}
              onPress={apply}
            >
              <Text style={styles.nextText}>{accepted ? `Apply ${accepted} change${accepted > 1 ? 's' : ''}` : 'Nothing selected'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorRow}>
          <CircleAlert size={15} color={c.redl} />
          <Text style={styles.error} accessibilityRole="alert">{error}</Text>
        </View>
      ) : null}
      {message ? <Text style={[styles.hint, { color: c.green }]} accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  );
}
