// On phones, tables turn into stacked cards (see "phone tables" in styles.css). For that, every cell needs the
// name of its column, which this copies from the table header into data-label. It watches the page, so tables
// that appear later (new pages, refreshed lists) are labelled too, without changing any page's code.
// Tables marked .items-table, .preview-table or .no-cards keep their normal layout.
const SKIP = '.items-table, .preview-table, .no-cards';

function labelTables() {
  for (const table of document.querySelectorAll('table.t')) {
    if (table.matches(SKIP)) continue;
    const heads = [...table.querySelectorAll(':scope > thead th')].map((th) => th.textContent.trim());
    if (!heads.length) continue;
    if (!table.classList.contains('cards')) table.classList.add('cards');
    for (const body of table.tBodies) {
      for (const row of body.rows) {
        let col = 0;
        for (const cell of row.cells) {
          const label = heads[col] || '';
          if (cell.dataset.label !== label) cell.dataset.label = label;
          col += cell.colSpan || 1;
        }
      }
    }
  }
}

export function enableResponsiveTables() {
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    // a microtask (not requestAnimationFrame, which never fires in background tabs) batches each burst of changes
    queueMicrotask(() => { queued = false; labelTables(); });
  }).observe(document.body, { childList: true, subtree: true });
  labelTables();
}
