'use strict';

const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const app = express();
app.use(fileUpload());

const SUPPORTED_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/tiff': 'tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};

const DOCX_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);

const MARGINS = {
  narrow: ['-o', 'page-top=17', '-o', 'page-bottom=17', '-o', 'page-left=17', '-o', 'page-right=17'],
  none:   ['-o', 'page-top=0',  '-o', 'page-bottom=0',  '-o', 'page-left=0',  '-o', 'page-right=0'],
};

function buildLpArgs(body = {}) {
  const args = [];
  const copies = parseInt(body.copies, 10);
  if (copies > 1) args.push('-n', String(copies));
  const pages = (body.pages || '').trim();
  if (pages) args.push('-P', pages);
  const nup = parseInt(body.nup, 10);
  if (nup > 1) args.push('-o', `number-up=${nup}`);
  if (body.orientation === 'landscape') args.push('-o', 'landscape');
  if (body.fit === 'on') args.push('-o', 'fit-to-page');
  const marginArgs = MARGINS[body.margins];
  if (marginArgs) args.push(...marginArgs);
  const sides = body.sides;
  if (sides && sides !== 'one-sided') args.push('-o', `sides=${sides}`);
  return args;
}

const PAGE_SIZES = [
  { name: 'A0', w: 2383.94, h: 3370.39 },
  { name: 'A1', w: 1683.78, h: 2383.94 },
  { name: 'A2', w: 1190.55, h: 1683.78 },
  { name: 'A3', w: 841.89, h: 1190.55 },
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A5', w: 419.53, h: 595.28 },
  { name: 'A6', w: 297.64, h: 419.53 },
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'Tabloid', w: 792, h: 1224 },
];

function getPageSizeName(width, height) {
  const w = Math.min(width, height);
  const h = Math.max(width, height);
  for (const size of PAGE_SIZES) {
    if (Math.abs(size.w - w) < 5 && Math.abs(size.h - h) < 5) return size.name;
  }
  const mmW = Math.round(w / 72 * 25.4);
  const mmH = Math.round(h / 72 * 25.4);
  return `${mmW}×${mmH} mm`;
}

async function parsePdf(filePath) {
  const pdfBytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(pdfBytes);
  const pageCount = doc.getPageCount();
  let orientation = 'portrait';
  let pageSize = null;
  if (pageCount > 0) {
    const { width, height } = doc.getPage(0).getSize();
    if (width > height) orientation = 'landscape';
    pageSize = getPageSizeName(width, height);
  }
  return { pageCount, orientation, pageSize };
}

const HTML_FORM = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🖨️ Print Portal</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:#f0f2f5;display:flex;align-items:center;
         justify-content:center;min-height:100vh;padding:1rem}
    .card{background:#fff;border-radius:16px;padding:2.5rem;
          box-shadow:0 4px 24px rgba(0,0,0,.1);max-width:480px;width:100%}
    h1{font-size:1.6rem;margin-bottom:.4rem}
    p.sub{color:#666;font-size:.9rem;margin-bottom:2rem}

    /* drop zone */
    .drop{border:2px dashed #ccc;border-radius:12px;padding:2.5rem 1rem;
          text-align:center;cursor:pointer;transition:border-color .2s;margin-bottom:1rem}
    .drop:hover,.drop.drag{border-color:#4f46e5;background:#f5f3ff}
    .drop input{display:none}
    .drop label{cursor:pointer;display:block}
    .drop .icon{font-size:2.5rem;display:block;margin-bottom:.5rem}
    .drop .hint{color:#666;font-size:.85rem;margin-top:.4rem}
    #filename{font-weight:600;color:#4f46e5;margin-top:.5rem;min-height:1.2em;word-break:break-all}

    /* options panel */
    #options{overflow:hidden;max-height:0;opacity:0;
             transition:max-height .35s ease,opacity .25s ease;margin-bottom:1rem}
    #options.visible{max-height:600px;opacity:1}
    .opt-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
    .opt-group{display:flex;flex-direction:column;gap:.3rem}
    .opt-group.full{grid-column:1/-1}
    .opt-group label{font-size:.78rem;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.04em}
    .opt-group input[type=number],
    .opt-group input[type=text],
    .opt-group select{width:100%;padding:.45rem .6rem;border:1.5px solid #e2e8f0;
                      border-radius:8px;font-size:.9rem;outline:none;
                      transition:border-color .15s;background:#fff}
    .opt-group input:focus,.opt-group select:focus{border-color:#4f46e5}
    .orient-row{display:flex;gap:.5rem}
    .orient-btn{flex:1;padding:.45rem;border:1.5px solid #e2e8f0;border-radius:8px;
                background:#fff;font-size:.85rem;cursor:pointer;transition:all .15s;
                text-align:center}
    .orient-btn.active{border-color:#4f46e5;background:#ede9fe;color:#4f46e5;font-weight:600}
    .check-row{display:flex;align-items:center;gap:.5rem;padding:.55rem .6rem;
               border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer}
    .check-row input{width:16px;height:16px;accent-color:#4f46e5;cursor:pointer}
    .check-row span{font-size:.9rem}

    /* divider */
    .divider{border:none;border-top:1px solid #f1f5f9;margin:.25rem 0 1rem}

    /* submit */
    button[type=submit]{width:100%;padding:.85rem;background:#4f46e5;color:#fff;
                         border:none;border-radius:10px;font-size:1rem;font-weight:600;
                         cursor:pointer;transition:background .2s}
    button[type=submit]:hover{background:#4338ca}
    button[type=submit]:disabled{background:#a5b4fc;cursor:not-allowed}
    #status{margin-top:1.2rem;text-align:center;font-size:.95rem;min-height:1.4em}
    .ok{color:#16a34a}.err{color:#dc2626}
  </style>
</head>
<body>
<div class="card">
  <h1>🖨️ Print Portal</h1>
  <p class="sub">Drop a file — it prints instantly on the default printer.</p>

  <form id="form" enctype="multipart/form-data" method="post" action="/print">
    <div class="drop" id="drop">
      <label for="file">
        <span class="icon">📄</span>
        <span>Tap or drag a file here</span>
        <div class="hint">PDF · DOCX · JPG · PNG</div>
        <div id="filename"></div>
      </label>
      <input type="file" id="file" name="file"
             accept=".pdf,.docx,.doc,.jpg,.jpeg,.png,.gif,.tiff">
    </div>

    <div id="options">
      <hr class="divider">
      <div id="page-info" style="font-size:.85rem;color:#666;margin-bottom:.75rem;min-height:1.2em"></div>
      <div class="opt-grid">

        <div class="opt-group">
          <label for="copies">Copies</label>
          <input type="number" id="copies" name="copies" min="1" value="1">
        </div>

        <div class="opt-group">
          <label for="pages">Page range</label>
          <input type="text" id="pages" name="pages" placeholder="All pages">
        </div>

        <div class="opt-group">
          <label for="nup">Pages per sheet</label>
          <select id="nup" name="nup">
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="4">4</option>
          </select>
        </div>

        <div class="opt-group">
          <label for="margins">Margins</label>
          <select id="margins" name="margins">
            <option value="normal">Normal</option>
            <option value="narrow">Narrow</option>
            <option value="none">None</option>
          </select>
        </div>

        <div class="opt-group">
          <label for="sides">Duplex</label>
          <select id="sides" name="sides">
            <option value="one-sided">Off</option>
            <option value="two-sided-long-edge">Long Edge</option>
            <option value="two-sided-short-edge">Short Edge</option>
          </select>
        </div>

        <div class="opt-group">
          <label>Orientation</label>
          <div class="orient-row">
            <button type="button" class="orient-btn active" id="btn-portrait"
                    onclick="setOrientation('portrait')">↕ Portrait</button>
            <button type="button" class="orient-btn" id="btn-landscape"
                    onclick="setOrientation('landscape')">↔ Landscape</button>
          </div>
          <input type="hidden" id="orientation" name="orientation" value="portrait">
        </div>

        <div class="opt-group full">
          <label class="check-row" for="fit">
            <input type="checkbox" id="fit" name="fit" value="on">
            <span>Fit to page width</span>
          </label>
        </div>

      </div>
      <hr class="divider" style="margin-top:.75rem">
    </div>

    <button type="submit" id="btn" disabled>Print</button>
  </form>
  <div id="status"></div>
</div>

<script>
  const LS_KEY = 'better-cups-opts';
  const input  = document.getElementById('file');
  const btn    = document.getElementById('btn');
  const drop   = document.getElementById('drop');
  const fn     = document.getElementById('filename');
  const status = document.getElementById('status');
  const form   = document.getElementById('form');
  const opts   = document.getElementById('options');

  // ── Orientation toggle ───────────────────────────────────────────────────
  function setOrientation(val) {
    document.getElementById('orientation').value = val;
    document.getElementById('btn-portrait').classList.toggle('active',  val === 'portrait');
    document.getElementById('btn-landscape').classList.toggle('active', val === 'landscape');
  }

  // ── localStorage persistence ─────────────────────────────────────────────
  function saveOpts() {
    const d = {
      copies:      document.getElementById('copies').value,
      pages:       document.getElementById('pages').value,
      nup:         document.getElementById('nup').value,
      margins:     document.getElementById('margins').value,
      orientation: document.getElementById('orientation').value,
      fit:         document.getElementById('fit').checked,
      sides:       document.getElementById('sides').value,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(d));
  }

  function loadOpts() {
    try {
      const d = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (d.copies)      document.getElementById('copies').value  = d.copies;
      if (d.pages)       document.getElementById('pages').value   = d.pages;
      if (d.nup)         document.getElementById('nup').value     = d.nup;
      if (d.margins)     document.getElementById('margins').value = d.margins;
      if (d.orientation) setOrientation(d.orientation);
      if (d.fit)         document.getElementById('fit').checked   = d.fit;
      if (d.sides)       document.getElementById('sides').value   = d.sides;
    } catch(_) {}
  }
  loadOpts();

  // ── File selection ────────────────────────────────────────────────────────
  function onFileSelected(file) {
    if (!file) return;
    fn.textContent = file.name;
    btn.disabled   = false;
    opts.classList.add('visible');
    parseFile(file);
  }

  async function parseFile(file) {
    const info = document.getElementById('page-info');
    info.textContent = 'Parsing file…';
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch('/parse', { method: 'POST', body: fd });
      if (!r.ok) { info.textContent = ''; return; }
      const meta = await r.json();
      const parts = [];
      if (meta.pageCount) parts.push(meta.pageCount + ' page' + (meta.pageCount > 1 ? 's' : ''));
      if (meta.pageSize)  parts.push(meta.pageSize);
      if (meta.orientation) {
        setOrientation(meta.orientation);
        parts.push(meta.orientation.charAt(0).toUpperCase() + meta.orientation.slice(1));
      }
      info.textContent = parts.join(' · ');
      if (meta.pageCount) {
        document.getElementById('pages').placeholder = '1\u2013' + meta.pageCount;
      }
    } catch(_) {
      info.textContent = '';
    }
  }

  input.addEventListener('change', () => onFileSelected(input.files[0]));

  ['dragover','dragenter'].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); drop.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', ev => {
    ev.preventDefault();
    if (ev.dataTransfer.files[0]) {
      input.files = ev.dataTransfer.files;
      onFileSelected(input.files[0]);
    }
  });

  // ── Submit ────────────────────────────────────────────────────────────────
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!input.files[0]) return;
    saveOpts();
    btn.disabled    = true;
    status.textContent = 'Sending to printer…';
    status.className   = '';
    const fd = new FormData(form);
    // Ensure fit value is included when unchecked (checkbox omitted by FormData if unchecked)
    if (!document.getElementById('fit').checked) fd.delete('fit');
    try {
      const r   = await fetch('/print', { method: 'POST', body: fd });
      const txt = await r.text();
      if (r.ok) { status.textContent = '✅ ' + txt; status.className = 'ok'; }
      else      { status.textContent = '❌ ' + txt; status.className = 'err'; }
    } catch(_) {
      status.textContent = '❌ Network error'; status.className = 'err';
    }
    btn.disabled = false;
  });
</script>
</body>
</html>`;

app.get('/', (_req, res) => res.send(HTML_FORM));

app.post('/parse', async (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send('No file attached.');
  }

  const file = req.files.file;
  const mime = file.mimetype;
  const ext = SUPPORTED_TYPES[mime];

  if (!ext) {
    return res.status(400).send(`Unsupported file type: ${mime}`);
  }

  const origName = file.name || 'upload';
  const origExt = path.extname(origName).toLowerCase().replace('.', '') || ext;
  const filePath = path.join(os.tmpdir(), `better-cups-parse-${Date.now()}.${origExt || ext}`);
  fs.writeFileSync(filePath, file.data);

  const cleanup = () => fs.unlink(filePath, () => {});

  try {
    if (DOCX_TYPES.has(mime)) {
      const outDir = os.tmpdir();
      await new Promise((resolve, reject) => {
        execFile('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], { timeout: 60000 }, (err, _stdout, stderr) => {
          cleanup();
          if (err) return reject(new Error(`LibreOffice conversion failed: ${stderr}`));
          resolve();
        });
      });
      const pdfPath = path.join(outDir, path.basename(filePath, path.extname(filePath)) + '.pdf');
      const meta = await parsePdf(pdfPath);
      fs.unlink(pdfPath, () => {});
      return res.json(meta);
    }

    if (mime === 'application/pdf') {
      const meta = await parsePdf(filePath);
      cleanup();
      return res.json(meta);
    }

    // Images: return basic info
    cleanup();
    return res.json({ pageCount: 1, orientation: null, pageSize: null });
  } catch (err) {
    cleanup();
    return res.status(500).send(err.message);
  }
});

app.post('/print', (req, res) => {
  if (!req.files || !req.files.file) {
    return res.status(400).send('No file attached.');
  }

  const file = req.files.file;
  const mime = file.mimetype;
  const ext = SUPPORTED_TYPES[mime];
  const origName = file.name || 'upload';
  const origExt = path.extname(origName).toLowerCase().replace('.', '') || ext;

  if (!ext) {
    return res.status(400).send(`Unsupported file type: ${mime}`);
  }

  const filePath = path.join(os.tmpdir(), `better-cups-${Date.now()}.${origExt || ext}`);
  fs.writeFileSync(filePath, file.data);

  const cleanup = () => fs.unlink(filePath, () => {});

  const lpArgs = buildLpArgs(req.body);

  if (DOCX_TYPES.has(mime)) {
    const outDir = os.tmpdir();
    execFile('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], { timeout: 60000 }, (err, _stdout, stderr) => {
      cleanup();
      if (err) {
        return res.status(500).send(`LibreOffice conversion failed: ${stderr}`);
      }
      const pdfPath = path.join(outDir, path.basename(filePath, path.extname(filePath)) + '.pdf');
      execFile('lp', [...lpArgs, pdfPath], { timeout: 30000 }, (lpErr, _out, lpStderr) => {
        fs.unlink(pdfPath, () => {});
        if (lpErr) return res.status(500).send(`Print failed: ${lpStderr}`);
        res.send('Job submitted to default printer.');
      });
    });
  } else {
    execFile('lp', [...lpArgs, filePath], { timeout: 30000 }, (err, _out, stderr) => {
      cleanup();
      if (err) return res.status(500).send(`Print failed: ${stderr}`);
      res.send('Job submitted to default printer.');
    });
  }
});

const PORT = process.env.PORT || 8080;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Print portal listening on :${PORT}`));
}

module.exports = { app };
