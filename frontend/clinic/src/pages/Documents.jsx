import { useState } from 'react';
import { Camera, Download, FileText, Search } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { Empty, ErrorCard, Loading, PageHead, useAsync, useDebounced, useModal } from '../../../shared/ui';
import { DOC_CATEGORIES, useApp } from '../context';
import { DocCards, UploadModal } from '../components/Documents';

export default function Documents() {
  const { canWrite, version } = useApp();
  const open = useModal();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const { data, error, loading, reload } = useAsync(() => api(`/api/documents${qs({ q: dq, category })}`), [dq, category, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Documents" sub="Photos of reports, prescriptions, X-rays and forms. Search even inside the text of a picture.">
        <a className="btn" href="/api/export/documents.xlsx" download><Download /><span>Export text</span></a>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <UploadModal close={c} />)}><Camera /><span>Upload</span></button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <div className="search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text inside documents, titles or patients…" /></div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All categories</option>{DOC_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <span className="spacer" /><span className="small muted">{data ? `${data.length} document${data.length === 1 ? '' : 's'}` : ''}</span>
        </div>
        <div className="card-body">
          {loading && !data ? <Loading minHeight={200} /> : data.length ? <DocCards list={data} showPatient />
            : dq || category ? <Empty icon={Search} title="No documents match" />
              : <Empty icon={FileText} title="No documents yet" text={canWrite ? 'Upload photos of lab reports, prescriptions, X-rays or forms. Their text is read automatically.' : ''} />}
        </div>
      </div>
    </>
  );
}
