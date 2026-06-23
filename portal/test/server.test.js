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
