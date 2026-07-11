'use strict';

const request = require('supertest');

// Stub child_process before any module loads
jest.mock('child_process', () => ({
  execFile: jest.fn((cmd, args, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(null, '', '');
  }),
}));

const { execFile } = require('child_process');
const { app } = require('../server');

beforeEach(() => {
  jest.clearAllMocks();
  execFile.mockImplementation((cmd, args, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb;
    callback(null, '', '');
  });
});

// Behavior 1: upload form is served
test('GET / serves the HTML upload form', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/html/);
  expect(res.text).toMatch(/form/i);
  expect(res.text).toMatch(/enctype="multipart\/form-data"/);
});

// Behavior 1b: form contains all print option fields
test('GET / form contains all 7 print option input fields', async () => {
  const res = await request(app).get('/');
  const html = res.text;
  expect(html).toMatch(/name="copies"/);
  expect(html).toMatch(/name="pages"/);
  expect(html).toMatch(/name="nup"/);
  expect(html).toMatch(/name="orientation"/);
  expect(html).toMatch(/name="fit"/);
  expect(html).toMatch(/name="margins"/);
  expect(html).toMatch(/name="sides"/);
});

// Behavior 2: unsupported file type is rejected
test('POST /print with unsupported file type returns 400', async () => {
  const res = await request(app)
    .post('/print')
    .attach('file', Buffer.from('data'), { filename: 'doc.xyz', contentType: 'application/octet-stream' });
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/unsupported/i);
});

// Behavior 3: PDF is sent directly to lp
test('POST /print with a PDF calls lp and returns 200', async () => {
  const res = await request(app)
    .post('/print')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'invoice.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining([expect.stringMatching(/\.pdf$/)]),
    expect.anything(),
    expect.any(Function)
  );
});

// Behavior 4: image (jpg/png) is sent directly to lp
test('POST /print with a JPEG calls lp and returns 200', async () => {
  const res = await request(app)
    .post('/print')
    .attach('file', Buffer.from('\xFF\xD8\xFF'), { filename: 'photo.jpg', contentType: 'image/jpeg' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining([expect.stringMatching(/\.jpg$/)]),
    expect.anything(),
    expect.any(Function)
  );
});

// Behavior 5: docx is converted via libreoffice, then sent to lp
test('POST /print with a DOCX converts via libreoffice then calls lp', async () => {
  // libreoffice produces a .pdf in /tmp; mock both calls
  execFile
    .mockImplementationOnce((cmd, args, opts, cb) => {
      // libreoffice call — simulate successful PDF output
      expect(cmd).toBe('libreoffice');
      expect(args).toContain('--headless');
      expect(args).toContain('--convert-to');
      expect(args).toContain('pdf');
      cb(null, '', '');
    })
    .mockImplementationOnce((cmd, args, opts, cb) => {
      // lp call
      expect(cmd).toBe('lp');
      expect(args.some(a => a.endsWith('.pdf'))).toBe(true);
      cb(null, '', '');
    });

  const res = await request(app)
    .post('/print')
    .attach('file', Buffer.from('PK'), { filename: 'report.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledTimes(2);
});

// Behavior 6: no file attached returns 400
test('POST /print with no file returns 400', async () => {
  const res = await request(app).post('/print');
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/no file/i);
});

// ── Print options ────────────────────────────────────────────────────────────

// Behavior 8: page range option passes -P to lp
test('POST /print with pages=2-4 passes -P 2-4 to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('pages', '2-4')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-P', '2-4']),
    expect.anything(),
    expect.any(Function)
  );
});

// Behavior 10: landscape orientation passes -o landscape to lp
test('POST /print with orientation=landscape passes -o landscape to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('orientation', 'landscape')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'landscape']),
    expect.anything(),
    expect.any(Function)
  );
});

// Behavior 12: narrow margins passes page-top/bottom/left/right=17 to lp
test('POST /print with margins=narrow passes page margin args to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('margins', 'narrow')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'page-top=17', '-o', 'page-bottom=17', '-o', 'page-left=17', '-o', 'page-right=17']),
    expect.anything(),
    expect.any(Function)
  );
});

// Behavior 13: no margins passes page-top/bottom/left/right=0 to lp
test('POST /print with margins=none passes zero margin args to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('margins', 'none')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'page-top=0', '-o', 'page-bottom=0', '-o', 'page-left=0', '-o', 'page-right=0']),
    expect.anything(),
    expect.any(Function)
  );
});
test('POST /print with fit=on passes -o fit-to-page to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('fit', 'on')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'fit-to-page']),
    expect.anything(),
    expect.any(Function)
  );
});
test('POST /print with nup=2 passes -o number-up=2 to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('nup', '2')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'number-up=2']),
    expect.anything(),
    expect.any(Function)
  );
});
test('POST /print with copies=3 passes -n 3 to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('copies', '3')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-n', '3']),
    expect.anything(),
    expect.any(Function)
  );
});

// ── Manual duplex / sides ───────────────────────────────────────────────────

test('side=1 + sides=long-edge passes -o page-set=odd to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('side', '1')
    .field('sides', 'long-edge')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'page-set=odd']),
    expect.anything(),
    expect.any(Function)
  );
});

test('side=1 + sides=short-edge passes -o page-set=odd to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('side', '1')
    .field('sides', 'short-edge')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'page-set=odd']),
    expect.anything(),
    expect.any(Function)
  );
});

test('side=2 + sides=long-edge passes page-set=even and outputorder=reverse to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('side', '2')
    .field('sides', 'long-edge')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-o', 'page-set=even', '-o', 'outputorder=reverse']),
    expect.anything(),
    expect.any(Function)
  );
});

test('side=2 + sides=short-edge passes -o page-set=even without outputorder to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('side', '2')
    .field('sides', 'short-edge')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  const lpCallArgs = execFile.mock.calls.find(c => c[0] === 'lp')[1];
  expect(lpCallArgs).toContain('-o');
  expect(lpCallArgs).toContain('page-set=even');
  expect(lpCallArgs).not.toContain('outputorder=reverse');
});

test('side=1 + copies=3 passes -n 3 and -o page-set=odd to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('side', '1')
    .field('sides', 'long-edge')
    .field('copies', '3')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(execFile).toHaveBeenCalledWith(
    'lp',
    expect.arrayContaining(['-n', '3', '-o', 'page-set=odd']),
    expect.anything(),
    expect.any(Function)
  );
});

// ── Parse endpoint ──────────────────────────────────────────────────────────

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    load: jest.fn(),
  },
}));

const { PDFDocument } = require('pdf-lib');

test('POST /parse with a PDF returns JSON metadata', async () => {
  const mockDoc = {
    getPageCount: jest.fn().mockReturnValue(12),
    getPage: jest.fn().mockReturnValue({ getSize: () => ({ width: 595.28, height: 841.89 }) }),
  };
  PDFDocument.load.mockResolvedValue(mockDoc);

  const res = await request(app)
    .post('/parse')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    pageCount: 12,
    orientation: 'portrait',
    pageSize: 'A4',
  });
});

test('POST /parse with a landscape PDF returns landscape orientation', async () => {
  const mockDoc = {
    getPageCount: jest.fn().mockReturnValue(5),
    getPage: jest.fn().mockReturnValue({ getSize: () => ({ width: 841.89, height: 595.28 }) }),
  };
  PDFDocument.load.mockResolvedValue(mockDoc);

  const res = await request(app)
    .post('/parse')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'landscape.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    pageCount: 5,
    orientation: 'landscape',
    pageSize: 'A4',
  });
});

test('POST /parse with unsupported file type returns 400', async () => {
  const res = await request(app)
    .post('/parse')
    .attach('file', Buffer.from('data'), { filename: 'doc.xyz', contentType: 'application/octet-stream' });
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/unsupported/i);
});

test('POST /parse with no file returns 400', async () => {
  const res = await request(app).post('/parse');
  expect(res.status).toBe(400);
  expect(res.text).toMatch(/no file/i);
});

test('sides=off passes no page-set arg to lp', async () => {
  const res = await request(app)
    .post('/print')
    .field('sides', 'off')
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(200);
  const lpCallArgs = execFile.mock.calls.find(c => c[0] === 'lp')[1];
  const pageSetArgs = lpCallArgs.filter(a => a.includes('page-set'));
  expect(pageSetArgs).toHaveLength(0);
});
