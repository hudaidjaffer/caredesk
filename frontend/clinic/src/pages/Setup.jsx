import { Plus, Stethoscope, Users } from 'lucide-react';
import { initials, safeColor } from '../../../shared/format';
import { Badge, Empty, PageHead, useModal } from '../../../shared/ui';
import { useApp } from '../context';
import { PractitionerModal, ServiceModal } from '../components/SetupModals';

export default function Setup() {
  const { refs, money, canWrite } = useApp();
  const open = useModal();
  return (
    <>
      <PageHead title="Services & team" sub="What you offer and who provides it" />
      <div className="halves">
        <div className="card">
          <div className="card-head"><h2>Team</h2><span className="spacer" />
            <button className="btn sm" disabled={!canWrite} onClick={() => open((c) => <PractitionerModal close={c} />)}><Plus /><span>Add</span></button></div>
          {refs.practitioners.length ? (
            <table className="t"><tbody>{refs.practitioners.map((p) => (
              <tr key={p.id} className={canWrite ? 'click' : ''} onClick={() => canWrite && open((c) => <PractitionerModal close={c} item={p} />)}>
                <td><div className="row"><span className="avatar" style={{ background: `${safeColor(p.color)}22`, color: safeColor(p.color) }}>{initials(p.name)}</span>
                  <div><b>{p.name}</b><div className="small muted">{p.role || ''}</div></div></div></td>
                <td className="right">{!p.active && <Badge status="cancelled">Inactive</Badge>}</td>
              </tr>
            ))}</tbody></table>
          ) : <Empty icon={Users} title="No team members yet" text="Add dentists, therapists and other staff who see patients." />}
        </div>
        <div className="card">
          <div className="card-head"><h2>Services &amp; fees</h2><span className="spacer" />
            <button className="btn sm" disabled={!canWrite} onClick={() => open((c) => <ServiceModal close={c} />)}><Plus /><span>Add</span></button></div>
          {refs.services.length ? (
            <table className="t"><thead><tr><th>Service</th><th>Duration</th><th className="right">Price</th></tr></thead>
              <tbody>{refs.services.map((s) => (
                <tr key={s.id} className={canWrite ? 'click' : ''} onClick={() => canWrite && open((c) => <ServiceModal close={c} item={s} />)}>
                  <td><b>{s.name}</b> {!s.active && <Badge status="cancelled">Inactive</Badge>}<div className="small muted">{s.category || ''}</div></td>
                  <td className="nowrap">{s.duration_min} min</td><td className="right mono">{money(s.price)}</td>
                </tr>
              ))}</tbody></table>
          ) : <Empty icon={Stethoscope} title="No services yet" text="Add treatments and their fees to speed up booking and invoicing." />}
        </div>
      </div>
    </>
  );
}
