// In-browser OCR (text recognition) using tesseract.js, plus helpers that pull useful fields
// out of the recognised text. Pictures are read on the user's own device.
const OCR = (() => {
  const LIB_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
  const LIB_SRI = 'sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM';

  const LANGS = {
    eng: 'English',
    'eng+urd': 'English + Urdu',
    'eng+ara': 'English + Arabic',
    'eng+hin': 'English + Hindi',
    'eng+ben': 'English + Bengali',
    'eng+fas': 'English + Persian',
    'eng+tur': 'English + Turkish',
    'eng+fra': 'English + French',
    'eng+spa': 'English + Spanish',
    'eng+deu': 'English + German',
  };

  const STATUS_TEXT = {
    'loading tesseract core': 'Loading the text reader',
    'initializing tesseract': 'Starting the text reader',
    'loading language traineddata': 'Downloading language data (first time only)',
    'loading language traineddata (from cache)': 'Loading language data',
    'initializing api': 'Getting ready',
    'recognizing text': 'Reading text',
  };

  let libPromise = null;
  let worker = null;
  let workerLang = null;
  let currentLogger = () => {};

  function lang() {
    try { return localStorage.getItem('ocrLang') || 'eng'; } catch { return 'eng'; }
  }
  function setLang(l) {
    try { if (LANGS[l]) localStorage.setItem('ocrLang', l); } catch { /* storage unavailable */ }
  }
  function langOptions(selected = lang()) {
    return Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${v}</option>`).join('');
  }

  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    if (!libPromise) {
      libPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB_URL;
        s.integrity = LIB_SRI;
        s.crossOrigin = 'anonymous';
        s.onload = () => resolve();
        s.onerror = () => { libPromise = null; reject(new Error('Could not load the text reader. Please check your internet connection.')); };
        document.head.append(s);
      });
    }
    return libPromise;
  }

  // Returns the recognised text. onProgress(percent, label) is called while working.
  // Jobs run one at a time because they share a single worker.
  let queue = Promise.resolve();
  function recognize(image, language = lang(), onProgress = () => {}) {
    const job = queue.then(() => runRecognize(image, language, onProgress));
    queue = job.catch(() => {});
    return job;
  }

  async function runRecognize(image, language, onProgress) {
    onProgress(0, 'Loading the text reader');
    await loadLib();
    currentLogger = (m) => onProgress(Math.round((m.progress || 0) * 100), STATUS_TEXT[m.status] || m.status);
    if (!worker || workerLang !== language) {
      if (worker) await worker.terminate().catch(() => {});
      worker = null;
      // one reusable worker; its log messages go to whichever call is currently running
      worker = await window.Tesseract.createWorker(language, 1, { logger: (m) => currentLogger(m) });
      workerLang = language;
    }
    const { data } = await worker.recognize(image);
    onProgress(100, 'Done');
    return cleanText(data.text);
  }

  function cleanText(t) {
    return String(t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Shrinks large phone photos (keeps them sharp enough to read) and converts to JPEG.
  async function prepareImage(file, maxSide = 2200) {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { blob: file, isImage: false };
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(`â€œ${file.name}â€ could not be opened. Please use a JPG or PNG photo.`));
        i.src = url;
      });
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.88));
      return { blob, isImage: true };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ------------------------------------------------------------ field extraction

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const two = (n) => String(n).padStart(2, '0');

  function iso(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return null;
    return `${y}-${two(m)}-${two(d)}`;
  }

  // Finds dates in many common formats; day/month order defaults to day-first.
  function findDates(text) {
    const out = [];
    const add = (index, value) => { if (value) out.push({ index, value }); };
    for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) add(m.index, iso(m[1], m[2], m[3]));
    for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      add(m.index, b > 12 && a <= 12 ? iso(m[3], a, b) : iso(m[3], b, a));
    }
    for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.]+([A-Za-z]{3,9})[\s\-.,]+(\d{2,4})\b/g)) {
      const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mon) add(m.index, iso(m[3], mon, m[1]));
    }
    for (const m of text.matchAll(/\b([A-Za-z]{3,9})[\s\-.]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-.]+(\d{4})\b/g)) {
      const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mon) add(m.index, iso(m[3], mon, m[2]));
    }
    return out.sort((x, y) => x.index - y.index);
  }

  // Value after a label like "Name: Ahmed Khan", or on the next line when the label stands alone.
  function labelled(lines, labelRe) {
    const re = new RegExp(`^\\s*(?:${labelRe})\\s*[:.\\-â€“|]?\\s*(.*)$`, 'i');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const v = m[1].trim();
      if (v.length > 1) return v;
      if (lines[i + 1] && !/[:]\s*$/.test(lines[i + 1])) return lines[i + 1].trim();
    }
    return '';
  }

  const titleCase = (s) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const stripTitle = (s) => s.replace(/^(mr|mrs|ms|miss|dr|prof)\.?\s+/i, '').replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim();

  function parsePatient(text) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const out = {};

    const email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    if (email) out.email = email[0].toLowerCase();

    const phone = (text.match(/\+?\d[\d\s\-()]{7,}\d/g) || [])
      .map((p) => p.trim())
      .find((p) => { const d = p.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15 && !/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(p); });
    if (phone) out.phone = phone.replace(/\s+/g, ' ');

    let first = labelled(lines, 'first\\s*name|given\\s*names?|forenames?');
    let last = labelled(lines, 'last\\s*name|surname|family\\s*name');
    const full = labelled(lines, "patient'?s?\\s*name|full\\s*name|name\\s*of\\s*patient|name");
    if (!first && full) {
      const parts = stripTitle(full).split(' ');
      first = parts.shift() || '';
      if (!last) last = parts.join(' ');
    }
    if (first) out.first_name = titleCase(stripTitle(first));
    if (last) out.last_name = titleCase(stripTitle(last));

    const dobLine = lines.find((l) => /\b(d\.?\s?o\.?\s?b|date\s*of\s*birth|birth\s*date|born)\b/i.test(l));
    let dob = dobLine ? findDates(dobLine)[0] : null;
    if (!dob && dobLine) {
      const next = lines[lines.indexOf(dobLine) + 1];
      if (next) dob = findDates(next)[0];
    }
    if (!dob) {
      const thisYear = new Date().getFullYear();
      dob = findDates(text).find((d) => Number(d.value.slice(0, 4)) < thisYear - 1);
    }
    if (dob) out.dob = dob.value;

    const g = text.match(/\b(?:sex|gender)\s*[:.\-]?\s*(male|female|m|f)\b/i);
    if (g) out.gender = /^f/i.test(g[1]) ? 'Female' : 'Male';

    const address = labelled(lines, 'address|residence');
    if (address) out.address = address;
    const allergies = labelled(lines, 'allerg(?:y|ies)|known\\s*allerg(?:y|ies)');
    if (allergies && !/^(none|nil|no|n\/a|nkda)\b/i.test(allergies)) out.allergies = allergies;
    const meds = labelled(lines, 'current\\s*medications?|medications?|medicines?');
    if (meds && !/^(none|nil|no|n\/a)\b/i.test(meds)) out.medications = meds;
    const emergency = labelled(lines, 'emergency\\s*contact|next\\s*of\\s*kin');
    if (emergency) out.emergency_contact = emergency;
    const insurance = labelled(lines, 'insurance(?:\\s*(?:company|provider|no\\.?|number))?|policy\\s*(?:no\\.?|number)|member\\s*id');
    if (insurance) out.insurance = insurance;
    return out;
  }

  function parseReceipt(text) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const out = {};
    const amountsIn = (l) => [...l.matchAll(/(\d{1,3}(?:[,\s]\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{2,})/g)]
      .map((m) => Number(m[1].replace(/[,\s]/g, ''))).filter((n) => n > 0 && n < 1e9);
    const priority = [/grand\s*total/i, /amount\s*(?:due|paid|payable)/i, /net\s*(?:total|amount|payable)/i, /^(?!.*sub\s*-?total).*\btotal\b/i, /\bbalance\b/i];
    for (const re of priority) {
      const line = [...lines].reverse().find((l) => re.test(l) && amountsIn(l).length);
      if (line) { out.amount = Math.max(...amountsIn(line)); break; }
    }
    if (!out.amount) {
      const decimals = lines.flatMap((l) => [...l.matchAll(/\d+[.,]\d{2}\b/g)].map((m) => Number(m[0].replace(',', '.'))));
      if (decimals.length) out.amount = Math.max(...decimals);
    }
    const date = findDates(text)[0];
    if (date) out.date = date.value;
    const shop = lines.find((l) => /[A-Za-z\p{L}]{3,}/u.test(l) && !/receipt|invoice|tax|date|time|tel|phone/i.test(l));
    if (shop) out.description = shop.slice(0, 80);
    return out;
  }

  return { LANGS, lang, setLang, langOptions, recognize, prepareImage, parsePatient, parseReceipt, findDates };
})();

export default OCR;
