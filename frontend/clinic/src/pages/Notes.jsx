import { useState } from 'react';
import { ClipboardList, Download, Plus, Search } from 'lucide-react';
import { api, qs } from '../../../shared/api';
import { Empty, ErrorCard, Loading, PageHead, useAsync, useDebounced, useModal } from '../../../shared/ui';
import { useApp } from '../context';
import { NoteItem } from '../components/common';
import NoteModal from '../components/NoteModal';

export default function Notes() {
  const { canWrite, version } = useApp();
  const open = useModal();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 250);
  const { data, error, loading, reload } = useAsync(() => api(`/api/notes${qs({ limit: 300, q: dq })}`), [dq, version]);
  if (error) return <ErrorCard error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Clinical notes" sub="Structured SOAP notes for every visit">
        <a className="btn" href="/api/export/notes.xlsx" download><Download /><span>Excel</span></a>
        <button className="btn primary" disabled={!canWrite} onClick={() => open((c) => <NoteModal close={c} />)}><Plus /><span>New note</span></button>
      </PageHead>
      <div className="card">
        <div className="toolbar"><div className="search"><Search /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patient, area, diagnosis or plan…" /></div></div>
        {loading && !data ? <Loading minHeight={200} /> : data.length
          ? data.map((n) => <NoteItem key={n.id} n={n} showPatient onOpen={(note) => open((c) => <NoteModal close={c} note={note} />)} />)
          : <Empty icon={ClipboardList} title={dq ? 'No notes match' : 'No clinical notes yet'} text={dq ? '' : 'Notes you write after each visit will appear here.'} />}
      </div>
    </>
  );
}
