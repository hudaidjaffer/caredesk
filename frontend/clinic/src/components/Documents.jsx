import { useEffect, useRef, useState } from 'react';
import { Camera, ClipboardList, Copy, Download, FileText, ScanText, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../../../shared/api';
import { fmtIso, fmtSize, wordCount } from '../../../shared/format';
import OCR from '../../../shared/ocr';
import { Field, Modal, Progress, useConfirm, useModal, useToast } from '../../../shared/ui';
import { DOC_CATEGORIES, useApp } from '../context';
import { PatientPicker } from './common';
import { saveScannedDoc } from './PatientModal';
import NoteModal from './NoteModal';

export function DocCards({ list, showPatient }) {
  const open = useModal();
  const view = (id) => open((close) => <DocViewer close={close} id={id} />);
  return (
    <div className="doc-grid">
      {list.map((d) => (
        <div key={d.id} className="doc-card" role="button" tabIndex={0}
          onClick={(e) => { if (!e.target.closest('a')) view(d.id); }} onKeyDown={(e) => e.key === 'Enter' && view(d.id)}>
          <div className="doc-thumb">{d.mime.startsWith('image/')
            ? <img src={`/api/documents/${d.id}/file`} loading="lazy" alt="" />
            : <><FileText /><span>PDF</span></>}</div>
          <div className="doc-info">
            <b>{d.title || d.filename || 'Document'}</b>
            <div className="small muted">{d.category || 'Other'} · {fmtIso(d.created_at)}</div>
            {showPatient && <div className="small"><a href={`#/patients/${d.patient_id}`}>{d.patient_name}</a></div>}
            <div className="doc-snip">{d.snippet || <span className="faint">No text read</span>}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function UploadModal({ close, preset = {} }) {
  const { refresh } = useApp();
  const toast = useToast();
  const input = useRef(null);
  const [patient, setPatient] = useState({ id: preset.patient_id || '', name: preset.patient_name || '' });
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState(preset.category || DOC_CATEGORIES[0]);
  const [title, setTitle] = useState('');
  const [lang, setLang] = useState(OCR.lang());
  const [doOcr, setDoOcr] = useState(true);
  const [over, setOver] = useState(false);
  const setStatus = (i, status) => setFiles((l) => l.map((x, j) => (j === i ? { ...x, ...status } : x)));
  const add = (list) => {
    const ok = [];
    for (const file of list) {
      if (!/^image\//.test(file.type) && file.type !== 'application/pdf') { toast(`${file.name}: only photos or PDF files`, true); continue; }
      if (file.size > 15e6) { toast(`${file.name} is larger than 15 MB`, true); continue; }
      ok.push({ file, status: '' });
    }
    setFiles((l) => [...l, ...ok]);
  };
  const submit = async () => {
    if (!patient.id) throw new Error('Please choose a patient.');
    if (!files.some((x) => !x.done)) throw new Error('Please add at least one photo or file.');
    OCR.setLang(lang);
    let saved = 0;
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.done) continue;
      setStatus(i, { status: 'Preparing…' });
      const { blob, isImage } = await OCR.prepareImage(item.file);
      let text = '';
      if (isImage && doOcr) text = await OCR.recognize(blob, lang, (pct, label) => setStatus(i, { status: `${label} ${pct}%` }));
      setStatus(i, { status: 'Uploading…' });
      const base = item.file.name.replace(/\.[^.]+$/, '');
      const t = title ? (files.length > 1 ? `${title} (${i + 1})` : title) : base;
      await saveScannedDoc(patient.id, blob, text, { title: t, category, filename: item.file.name, lang });
      setStatus(i,{ done: true, status: `✓ Saved${text ? ` · ${wordCount(text)} words read` : ''}` });
      saved++;
    }
    toast(`${saved} document${saved === 1 ? '' : 's'} uploaded`);
    refresh();
  };
  return (
    <Modal title="Upload photos & documents" wide onClose={close} onSubmit={submit} submitLabel="Upload & read text">
      <div className="stack">
        {preset.patient_id ? <div>Patient: <b>{preset.patient_name}</b></div>
          : <PatientPicker value={patient.id} name={patient.name} onChange={(id, name) => setPatient({ id, name })} />}
        <div className={`dropzone${over ? ' over' : ''}`} role="button" tabIndex={0} onClick={() => input.current.click()}
          onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}>
          <Camera /><b>Take a photo or choose files</b>
          <span className="small muted">or drag &amp; drop here · JPG, PNG, WEBP or PDF · up to 15 MB each</span>
          <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
        </div>
        {files.length > 0 && (
          <div className="file-list">{files.map((x, i) => (
            <div className="file-row" key={i}>
              {x.file.type === 'application/pdf' ? <FileText /> : <Camera />}
              <span className="fname">{x.file.name}</span><span className="faint small">{fmtSize(x.file.size)}</span>
              <span className="spacer" /><span className="small" style={x.done ? { color: 'var(--success)', fontWeight: 600 } : undefined}>{x.status}</span>
              {!x.done && <button type="button" className="btn ghost icon sm" onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}><X /></button>}
            </div>
          ))}</div>
        )}
        <div className="grid3">
          <Field label="Category"><select value={category} onChange={(e) => setCategory(e.target.value)}>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Title (optional)"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Uses the file name if empty" /></Field>
          <Field label="Language of the text"><select value={lang} onChange={(e) => setLang(e.target.value)}>
            {Object.entries(OCR.LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={doOcr} onChange={(e) => setDoOcr(e.target.checked)} /> Read the text from photos automatically (OCR)</label>
        <p className="small faint" style={{ margin: 0 }}>Text is read on this device. Photos are stored encrypted in your clinic account. The first scan downloads the text reader (a few MB).</p>
      </div>
    </Modal>
  );
}

export function DocViewer({ close, id }) {
  const { canWrite, aiOn, refresh } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const open = useModal();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ title: '', category: 'Other', ocr_text: '' });
  const [lang, setLang] = useState(OCR.lang());
  const [prog, setProg] = useState(null);
  const [tidy, setTidy] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let alive = true;
    api(`/api/documents/${encodeURIComponent(id)}`).then((doc) => {
      if (!alive) return;
      setD(doc);
      setF({ title: doc.title || '', category: doc.category || 'Other', ocr_text: doc.ocr_text || '' });
      if (doc.ocr_lang) setLang(doc.ocr_lang);
    }).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [id]);
  if (error) return <Modal title="Document" onClose={close} hideSubmit><div className="form-error">{error}</div></Modal>;
  if (!d) return null;
  const isImg = d.mime.startsWith('image/');
  const fileUrl = `/api/documents/${d.id}/file`;
  const ro = !canWrite;

  const readAgain = async () => {
    setMsg('');
    try {
      OCR.setLang(lang);
      const blob = await fetch(fileUrl, { credentials: 'same-origin' }).then((r) => r.blob());
      const text = await OCR.recognize(blob, lang, (pct, label) => setProg({ pct, label }));
      setF((s) => ({ ...s, ocr_text: text }));
      setMsg(`✓ ${wordCount(text)} words read. Press “Save changes” to keep them.`);
    } catch (err) { setMsg(err.message); } finally { setProg(null); }
  };
  const aiTidy = async () => {
    setAiBusy(true);
    setMsg('');
    try {
      if (f.ocr_text !== (d.ocr_text || '')) await api(`/api/documents/${d.id}`, { method: 'PUT', body: { ocr_text: f.ocr_text } });
      setTidy(await api('/api/ai/tidy-document', { method: 'POST', body: { document_id: d.id } }));
    } catch (err) { setMsg(err.message); } finally { setAiBusy(false); }
  };

  return (
    <Modal title={d.title || d.filename || 'Document'} wide onClose={close} hideSubmit={ro} submitLabel="Save changes"
      onSubmit={async () => {
        await api(`/api/documents/${d.id}`, { method: 'PUT', body: { title: f.title, category: f.category, ocr_text: f.ocr_text, ocr_lang: lang } });
        toast('Document saved');
        refresh();
      }}
      footLeft={<>
        {!ro && <button type="button" className="btn danger icon" title="Delete" onClick={async () => {
          if (!(await confirm('This document and its picture will be permanently deleted.'))) return;
          await api(`/api/documents/${d.id}`, { method: 'DELETE' }); toast('Document deleted'); close(); refresh();
        }}><Trash2 /></button>}
        <a className="btn sm" href={`${fileUrl}?download=1`}><Download /><span>Download</span></a>
        <button type="button" className="btn sm" onClick={async () => {
          if (!f.ocr_text) return toast('There is no text to copy', true);
          try { await navigator.clipboard.writeText(f.ocr_text); toast('Text copied'); } catch { toast('Copy failed', true); }
        }}><Copy /><span>Copy text</span></button>
        {!ro && <button type="button" className="btn sm" onClick={() => {
          close();
          open((c) => <NoteModal close={c} preset={{ patient_id: d.patient_id, patient_name: d.patient_name,
            objective: `From ${d.title || d.category || 'document'} (${fmtIso(d.created_at)}):\n${f.ocr_text.trim()}` }} />);
        }}><ClipboardList /><span>Add to note</span></button>}
      </>}>
      <div className="doc-view">
        <div className="doc-view-img">{isImg
          ? <a href={fileUrl} target="_blank" rel="noopener noreferrer" title="Open full size"><img src={fileUrl} alt="" /></a>
          : <div className="empty"><FileText /><b>PDF document</b><a href={`${fileUrl}?download=1`}>Download to view</a></div>}</div>
        <div className="stack">
          <div className="small muted">Patient: <a href={`#/patients/${d.patient_id}`} onClick={close}>{d.patient_name}</a> · uploaded {fmtIso(d.created_at)}{d.size ? ` · ${fmtSize(d.size)}` : ''}</div>
          <div className="grid2">
            <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></Field>
          </div>
          <Field label={<>Text read from the picture <span className="faint">(you can correct it)</span></>}>
            <textarea className="ocr-text" value={f.ocr_text} onChange={(e) => setF({ ...f, ocr_text: e.target.value })}
              placeholder={isImg ? 'No text yet. Use “Read text” below.' : 'Text reading works on photos. Type notes about this PDF here.'} />
          </Field>
          {!ro && (
            <div className="row wrap">
              {isImg && <>
                <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 'auto' }}>{Object.entries(OCR.LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <button type="button" className="btn sm" disabled={!!prog} onClick={readAgain}><ScanText /><span>{d.ocr_text ? 'Read text again' : 'Read text'}</span></button>
              </>}
              {aiOn && f.ocr_text.trim().length > 5 && <button type="button" className="btn sm" disabled={aiBusy} onClick={aiTidy}>
                <Sparkles /><span>{aiBusy ? 'Tidying…' : 'Tidy text & find values (AI)'}</span></button>}
            </div>
          )}
          {prog && <Progress pct={prog.pct} label={prog.label} />}
          {msg && <div className={msg.startsWith('✓') ? 'small ok-text' : 'form-error'}>{msg}</div>}
          {tidy && (
            <div className="ai-box">
              <div className="ai-head"><Sparkles size={18} />{tidy.document_type || 'Document'}{tidy.document_date && <span className="muted small">· {tidy.document_date}</span>}</div>
              {tidy.summary && <p style={{ margin: '0 0 10px' }}>{tidy.summary}</p>}
              {tidy.values.length > 0 && (
                <div className="table-wrap"><table className="t" style={{ fontSize: 13 }}>
                  <thead><tr><th>Test / measure</th><th>Value</th><th>Unit</th><th>Range</th><th /></tr></thead>
                  <tbody>{tidy.values.map((v, i) => (
                    <tr key={i}><td>{v.name}</td><td className="mono"><b>{v.value}</b></td><td>{v.unit}</td><td className="muted">{v.reference_range}</td>
                      <td>{v.flag && v.flag !== 'normal' && <span className="badge b-no_show">{v.flag}</span>}</td></tr>
                  ))}</tbody></table></div>
              )}
              <div className="row wrap" style={{ marginTop: 10 }}>
                <button type="button" className="btn sm primary" onClick={() => { setF((s) => ({ ...s, ocr_text: tidy.clean_text })); setTidy(null); setMsg('✓ Tidied text placed in the box. Press “Save changes” to keep it.'); }}>Use tidied text</button>
                <button type="button" className="btn sm" onClick={() => setTidy(null)}>Dismiss</button>
              </div>
              <div className="ai-note">AI-generated from the scanned text. Check values against the original document.</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
