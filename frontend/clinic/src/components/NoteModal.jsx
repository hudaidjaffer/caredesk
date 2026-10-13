import { useState } from 'react';
import { Sparkles, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../../shared/api';
import { localDate } from '../../../shared/format';
import { Field, Modal, useConfirm, useToast } from '../../../shared/ui';
import { useApp } from '../context';
import { PatientPicker, practitionerOptions } from './common';

const SOAP = ['subjective', 'objective', 'assessment', 'plan'];

export default function NoteModal({ close, note = null, preset = {} }) {
  const { refs, canWrite, aiOn, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const firstPrac = refs.practitioners.find((p) => p.active);
  const n = note || { date: preset.date || localDate(), patient_id: preset.patient_id || '', practitioner_id: preset.practitioner_id || (firstPrac ? firstPrac.id : ''), objective: preset.objective || '' };
  const [f, setF] = useState({
    patient_id: n.patient_id, patient_name: note ? note.patient_name : preset.patient_name || '', date: n.date,
    practitioner_id: n.practitioner_id || '', area: n.area || '', subjective: n.subjective || '', objective: n.objective || '',
    assessment: n.assessment || '', plan: n.plan || '',
  });
  const [rough, setRough] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [showAi, setShowAi] = useState(!note && aiOn);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ro = !canWrite;

  const draft = async () => {
    setAiBusy(true);
    setAiError('');
    try {
      const r = await api('/api/ai/soap', { method: 'POST', body: { text: rough, patient_id: f.patient_id || undefined } });
      setF((s) => ({ ...s, area: s.area || r.area, ...Object.fromEntries(SOAP.map((k) => [k, r[k] || s[k]])) }));
      toast('Draft ready. Please review it before saving.');
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  const save = async () => {
    if (!f.patient_id) throw new Error('Please choose a patient.');
    const body = { patient_id: f.patient_id, date: f.date, practitioner_id: f.practitioner_id, area: f.area, subjective: f.subjective,
      objective: f.objective, assessment: f.assessment, plan: f.plan };
    if (note) await api(`/api/notes/${note.id}`, { method: 'PUT', body });
    else await api('/api/notes', { method: 'POST', body });
    toast('Clinical note saved');
    refresh();
  };

  return (
    <Modal title={note ? 'Clinical note' : 'New clinical note'} wide onClose={close} onSubmit={save} hideSubmit={ro}
      submitLabel={note ? 'Save changes' : 'Save note'}
      footLeft={<>
        {note && !ro && <button type="button" className="btn danger" onClick={async () => {
          if (!(await confirm('This clinical note will be permanently deleted.'))) return;
          await api(`/api/notes/${note.id}`, { method: 'DELETE' }); toast('Note deleted'); close(); refresh();
        }}><Trash2 /><span>Delete</span></button>}
        {aiOn && !ro && !showAi && <button type="button" className="btn sm" onClick={() => setShowAi(true)}><Sparkles /><span>Write with AI</span></button>}
      </>}>
      <div className="grid2">
        {showAi && !ro && (
          <div className="span2 ai-box">
            <div className="ai-head"><Sparkles size={18} />Write the note from your rough notes</div>
            <textarea value={rough} onChange={(e) => setRough(e.target.value)} style={{ minHeight: 70 }}
              placeholder="e.g. pt c/o sharp pain UL6 2/52, worse w/ cold. caries mesial UL6, no swelling. composite filling done, review 6/12" />
            {aiError && <div className="form-error" style={{ marginTop: 8 }}>{aiError}</div>}
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button type="button" className="btn primary sm" disabled={aiBusy || rough.trim().length < 5} onClick={draft}>
                <Wand2 /><span>{aiBusy ? 'Writing…' : 'Draft SOAP note'}</span></button>
              <span className="small faint">The AI only uses what you type. Always review before saving.</span>
            </div>
          </div>
        )}
        <div className="span2"><PatientPicker value={f.patient_id} name={f.patient_name} onChange={(id, name) => setF((s) => ({ ...s, patient_id: id, patient_name: name }))} /></div>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} /></Field>
        <Field label="Practitioner"><select value={f.practitioner_id} onChange={set('practitioner_id')}>{practitionerOptions(refs.practitioners, f.practitioner_id)}</select></Field>
        <Field label="Tooth / area / session focus" className="span2"><input value={f.area} onChange={set('area')} placeholder="e.g. Upper left molar (26) · Lower back · Anxiety management" /></Field>
        <Field label="Subjective: what the patient reports"><textarea value={f.subjective} onChange={set('subjective')} placeholder="Symptoms, concerns, history in the patient's words" /></Field>
        <Field label="Objective: examination findings"><textarea value={f.objective} onChange={set('objective')} placeholder="Observations, measurements, test results" /></Field>
        <Field label="Assessment: diagnosis / impression"><textarea value={f.assessment} onChange={set('assessment')} /></Field>
        <Field label="Plan: treatment and next steps"><textarea value={f.plan} onChange={set('plan')} /></Field>
      </div>
    </Modal>
  );
}
