// "Scan a photo to fill this form": runs OCR in the browser, then the parent fills empty fields.
import { useRef, useState } from 'react';
import { AlertTriangle, Camera, Check, ScanText } from 'lucide-react';
import OCR from '../../../shared/ocr';
import { Progress } from '../../../shared/ui';

export default function ScanBar({ title, hint, onText }) {
  const input = useRef(null);
  const [lang, setLang] = useState(OCR.lang());
  const [prog, setProg] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const run = async (file) => {
    setError('');
    setResult(null);
    try {
      OCR.setLang(lang);
      setProg({ pct: 0, label: 'Preparing photo' });
      const { blob } = await OCR.prepareImage(file);
      const text = await OCR.recognize(blob, lang, (pct, label) => setProg({ pct, label }));
      const filled = onText(text, { blob, filename: file.name, lang });
      setResult({ text, filled });
    } catch (err) {
      setError(err.message);
    } finally {
      setProg(null);
    }
  };
  return (
    <div>
      <div className="scan-bar">
        <span className="ico tone-teal"><ScanText /></span>
        <div style={{ flex: 1, minWidth: 180 }}><b>{title}</b><div className="small muted">{hint}</div></div>
        <select value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 'auto' }}>
          {Object.entries(OCR.LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="button" className="btn" disabled={!!prog} onClick={() => input.current.click()}><Camera /><span>Scan photo</span></button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) run(f); }} />
      </div>
      {(prog || result || error) && (
        <div className="scan-status">
          {prog && <Progress pct={prog.pct} label={prog.label} />}
          {error && <div className="form-error">{error}</div>}
          {result && (
            <div className="scan-result">
              <div>{result.filled.length
                ? <><Check size={16} /> Filled <b>{result.filled.length}</b> field{result.filled.length === 1 ? '' : 's'}: {result.filled.join(', ')}. <b>Please check them.</b></>
                : <><AlertTriangle size={16} /> Couldn't find the fields automatically. You can copy from the text below.</>}</div>
              <details><summary>Show text read from the photo</summary><pre>{result.text || '(no text found)'}</pre></details>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Fills only empty fields from `values`; returns [newForm, filledLabels, filledKeys]
export function fillEmpty(form, values, labels) {
  const next = { ...form };
  const filled = [];
  const keys = [];
  for (const [k, v] of Object.entries(values)) {
    if (!v || String(form[k] || '').trim()) continue;
    next[k] = v;
    filled.push(labels[k] || k);
    keys.push(k);
  }
  return [next, filled, keys];
}
