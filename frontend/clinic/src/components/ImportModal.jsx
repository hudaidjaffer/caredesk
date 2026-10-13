import { useRef, useState } from 'react';
import { CircleCheck, Download, FileSpreadsheet } from 'lucide-react';
import { api, qs, uploadFile } from '../../../shared/api';
import { Field, Modal, useToast } from '../../../shared/ui';
import { useApp } from '../context';

export default function ImportModal({ close }) {
  const { refresh } = useApp();
  const toast = useToast();
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (file) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const p = await uploadFile(`/api/import/patients/preview${qs({ filename: file.name })}`, file);
      setPreview(p);
      setMapping(p.mapping);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const submit = async () => {
    if (result) return false;
    if (!preview) throw new Error('Choose a file first.');
    const r = await api('/api/import/patients/commit', { method: 'POST', body: { token: preview.token, mapping } });
    setResult(r);
    toast(`${r.created} patient${r.created === 1 ? '' : 's'} imported`);
    refresh();
    return true;
  };

  const setField = (field, idx) => setMapping((m) => {
    const next = { ...m };
    if (idx === '') delete next[field]; else next[field] = Number(idx);
    return next;
  });

  return (
    <Modal title="Import patients from Excel" wide onClose={close} onSubmit={submit}
      submitLabel={result ? 'Done' : preview ? `Import ${preview.total} rows` : 'Import'} submitDisabled={!preview && !result}>
      {result ? (
        <div className="stack">
          <div className="banner active" style={{ margin: 0 }}><CircleCheck /><span><b>{result.created}</b> patient{result.created === 1 ? '' : 's'} imported.
            {result.duplicates > 0 && <> {result.duplicates} already existed and {result.duplicates === 1 ? 'was' : 'were'} skipped.</>}</span></div>
          {result.errors.length > 0 && (
            <div className="card"><div className="card-head"><h3>Rows to check</h3></div>
              <div className="card-body">{result.errors.map((e, i) => <div key={i} className="small">Row {e.row}: {e.message}</div>)}</div></div>
          )}
        </div>
      ) : (
        <div className="stack">
          <div className="dropzone" role="button" tabIndex={0} onClick={() => input.current.click()} onKeyDown={(e) => e.key === 'Enter' && input.current.click()}>
            <FileSpreadsheet /><b>{busy ? 'Reading the file…' : preview ? 'Choose a different file' : 'Choose an Excel (.xlsx) or CSV file'}</b>
            <span className="small muted">The first row should contain column names, e.g. Name, Phone, Date of birth</span>
            <input ref={input} type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
          </div>
          <div className="small"><a href="/api/import/patients/template.xlsx" download><Download size={14} style={{ verticalAlign: -2 }} /> Download a template</a>
            <span className="muted"> · Existing patients (same name and phone or date of birth) are skipped, so importing twice is safe.</span></div>
          {error && <div className="form-error">{error}</div>}
          {preview && (
            <>
              <h3>Match your columns</h3>
              <div className="map-grid">
                {Object.entries(preview.fields).map(([field, label]) => (
                  <Field key={field} label={label}>
                    <select value={mapping[field] ?? ''} onChange={(e) => setField(field, e.target.value)}>
                      <option value="">Not in file</option>
                      {preview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
              <h3>Preview <span className="muted small">(first {preview.sample.length} of {preview.total} rows)</span></h3>
              <div className="table-wrap card"><table className="t preview-table">
                <thead><tr>{preview.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
                <tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((_, j) => <td key={j} title={r[j]}>{r[j]}</td>)}</tr>)}</tbody>
              </table></div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
