'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const upload = multer({ dest: os.tmpdir() });

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

const HTML_FORM = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🖨️ Print Portal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #f0f2f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; padding: 1rem; }
    .card { background: white; border-radius: 16px; padding: 2.5rem;
            box-shadow: 0 4px 24px rgba(0,0,0,.1); max-width: 480px; width: 100%; }
    h1 { font-size: 1.6rem; margin-bottom: .4rem; }
    p.sub { color: #666; font-size: .9rem; margin-bottom: 2rem; }
    .drop { border: 2px dashed #ccc; border-radius: 12px; padding: 2.5rem 1rem;
            text-align: center; cursor: pointer; transition: border-color .2s;
            margin-bottom: 1.5rem; }
    .drop:hover, .drop.drag { border-color: #4f46e5; background: #f5f3ff; }
    .drop input { display: none; }
    .drop label { cursor: pointer; display: block; }
    .drop .icon { font-size: 2.5rem; display: block; margin-bottom: .5rem; }
    .drop .hint { color: #666; font-size: .85rem; margin-top: .4rem; }
    #filename { font-weight: 600; color: #4f46e5; margin-top: .5rem;
                min-height: 1.2em; word-break: break-all; }
    button { width: 100%; padding: .85rem; background: #4f46e5; color: white;
             border: none; border-radius: 10px; font-size: 1rem; font-weight: 600;
             cursor: pointer; transition: background .2s; }
    button:hover { background: #4338ca; }
    button:disabled { background: #a5b4fc; cursor: not-allowed; }
    #status { margin-top: 1.2rem; text-align: center; font-size: .95rem;
              min-height: 1.4em; }
    .ok { color: #16a34a; } .err { color: #dc2626; }
  </style>
</head>
<body>
<div class="card">
  <h1>🖨️ Print Portal</h1>
  <p class="sub">Drop a file below — it prints instantly on the default printer.</p>
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
    <button type="submit" id="btn" disabled>Print</button>
  </form>
  <div id="status"></div>
</div>
<script>
  const input = document.getElementById('file');
  const btn = document.getElementById('btn');
  const drop = document.getElementById('drop');
  const fn = document.getElementById('filename');
  const status = document.getElementById('status');
  const form = document.getElementById('form');

  input.addEventListener('change', () => {
    if (input.files[0]) { fn.textContent = input.files[0].name; btn.disabled = false; }
  });

  ['dragover','dragenter'].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); drop.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(e => drop.addEventListener(e, () => drop.classList.remove('drag')));
  drop.addEventListener('drop', ev => {
    ev.preventDefault();
    input.files = ev.dataTransfer.files;
    input.dispatchEvent(new Event('change'));
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!input.files[0]) return;
    btn.disabled = true;
    status.textContent = 'Sending to printer…';
    status.className = '';
    const fd = new FormData(form);
    try {
      const r = await fetch('/print', { method: 'POST', body: fd });
      const txt = await r.text();
      if (r.ok) { status.textContent = '✅ ' + txt; status.className = 'ok'; }
      else      { status.textContent = '❌ ' + txt; status.className = 'err'; }
    } catch(e) {
      status.textContent = '❌ Network error'; status.className = 'err';
    }
    btn.disabled = false;
  });
</script>
</body>
</html>`;

app.get('/', (_req, res) => res.send(HTML_FORM));

app.post('/print', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file attached.');
  }

  const mime = req.file.mimetype;
  const ext = SUPPORTED_TYPES[mime];
  const origName = req.file.originalname || 'upload';
  const origExt = path.extname(origName).toLowerCase().replace('.', '') || ext;

  if (!ext) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).send(`Unsupported file type: ${mime}`);
  }

  // Rename temp file to have correct extension (lp needs it for some drivers)
  const filePath = `${req.file.path}.${origExt || ext}`;

  fs.rename(req.file.path, filePath, (renameErr) => {
    if (renameErr) {
      return res.status(500).send('Failed to process upload.');
    }

    const cleanup = () => fs.unlink(filePath, () => {});

    if (DOCX_TYPES.has(mime)) {
      // Convert docx/doc → pdf via LibreOffice, then print the PDF
      const outDir = os.tmpdir();
      execFile('libreoffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, filePath], { timeout: 60000 }, (err, _stdout, stderr) => {
        cleanup();
        if (err) {
          return res.status(500).send(`LibreOffice conversion failed: ${stderr}`);
        }
        const pdfPath = path.join(outDir, path.basename(filePath, path.extname(filePath)) + '.pdf');
        execFile('lp', [pdfPath], { timeout: 30000 }, (lpErr, _out, lpStderr) => {
          fs.unlink(pdfPath, () => {});
          if (lpErr) return res.status(500).send(`Print failed: ${lpStderr}`);
          res.send('Job submitted to default printer.');
        });
      });
    } else {
      // PDF and images go directly to lp
      execFile('lp', [filePath], { timeout: 30000 }, (err, _out, stderr) => {
        cleanup();
        if (err) return res.status(500).send(`Print failed: ${stderr}`);
        res.send('Job submitted to default printer.');
      });
    }
  });
});

const PORT = process.env.PORT || 8080;

if (require.main === module) {
  app.listen(PORT, () => console.log(`Print portal listening on :${PORT}`));
}

module.exports = { app };
