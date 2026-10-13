// Minimal, safe Markdown renderer for AI answers: builds React elements (never raw HTML),
// so nothing in an AI reply can inject scripts or markup.
function inline(text, keyBase) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g);
  return parts.map((p, i) => {
    const k = `${keyBase}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={k}>{p.slice(1, -1)}</code>;
    if (/^\*[^*]+\*$/.test(p) || /^_[^_]+_$/.test(p)) return <em key={k}>{p.slice(1, -1)}</em>;
    return p;
  });
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export default function Markdown({ text }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    // table: header row + separator row
    if (/^\s*\|.*\|\s*$/.test(line) && lines[i + 1] && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push(
        <div className="table-wrap" key={key++}>
          <table><thead><tr>{head.map((h, j) => <th key={j}>{inline(h, `h${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `c${ri}${ci}`)}</td>)}</tr>)}</tbody></table>
        </div>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const Tag = h[1].length <= 2 ? 'h3' : 'h4';
      out.push(<Tag key={key++}>{inline(h[2], `t${key}`)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*•])\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*•])\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*•]\s+/, ''));
        i++;
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={key++}>{items.map((it, j) => <li key={j}>{inline(it, `l${key}${j}`)}</li>)}</List>);
      continue;
    }
    // paragraph: always consumes at least this line (so stray "| x |" lines can't stall the loop)
    const para = [lines[i]];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push(<p key={key++}>{para.map((p, j) => <span key={j}>{j > 0 && <br />}{inline(p, `p${key}${j}`)}</span>)}</p>);
  }
  return <div className="md">{out}</div>;
}
