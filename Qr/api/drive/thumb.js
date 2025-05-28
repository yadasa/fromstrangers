// api/drive/thumb.js
//
// Streams an image file from Google Drive to the browser.
// Expects: /api/drive/thumb?id=FILE_ID[&max=320]
// ─────────────────────────────────────────────────────────
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import stream from 'stream';

export default async function handler(req, res) {
  const { id, max = 320 } = req.query;
  if (!id) return res.status(400).send('missing id');

  /* ─── Credential handling (same as list.js) ─── */
  let key;
  if (process.env.GOOGLE_SA_KEY) {
    try { key = JSON.parse(process.env.GOOGLE_SA_KEY); }
    catch (e) {
      console.error('Invalid GOOGLE_SA_KEY JSON');
      return res.status(500).send('sa-key misconfigured');
    }
  } else {
    const keyPath = join(process.cwd(), 'api/drive/service-account.json');
    if (!existsSync(keyPath)) {
      console.error('service-account.json not found');
      return res.status(500).send('sa-key missing');
    }
    try { key = JSON.parse(readFileSync(keyPath, 'utf8')); }
    catch (e) {
      console.error('Error parsing service-account.json');
      return res.status(500).send('sa-key invalid');
    }
  }

  const auth  = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });

  try {
    /* Drive has no official “thumbnailSize” param for files.get alt=media.
       We simply grab the file bytes and let the <img> element scale it.
       If you need smaller payloads, resize client-side or cache resized
       versions at your own edge later. */
    const { data, headers } = await drive.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );

    // Pass through Google’s mime-type (JPEG, PNG, HEIC converted, etc.)
    res.setHeader('Content-Type', headers['content-type'] || 'image/jpeg');
    // Cache for one day so reloads don’t hammer Drive again
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');

    // Stream to the client
    stream.pipeline(data, res, err => {
      if (err) {
        console.error('thumb proxy error', err);
        if (!res.headersSent) res.status(500).end('stream failed');
      }
    });
  } catch (err) {
    console.error('Drive thumb error', err.code, err.message);
    const code = err.code === 404 ? 404 : 500;
    res.status(code).send('thumb fetch failed');
  }
}
