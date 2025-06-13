// api/drive/thumb.js
//
// Streams an image file (or the first frame of a video) from Google Drive to the browser.
// Expects: /api/drive/thumb?id=FILE_ID[&max=320]
// ─────────────────────────────────────────────────────────

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import stream from 'stream';
import ffmpegPath from 'ffmpeg-static';
const { spawn } = require('child_process');

export default async function handler(req, res) {
  const { id, max = 320 } = req.query;
  if (!id) {
    return res.status(400).send('missing id');
  }

  console.log(`[thumb.js]  incoming id=${id}`);

  /* ─── Credential handling ───────────────────────────────────── */
  let key;
  if (process.env.GOOGLE_SA_KEY) {
    try {
      key = JSON.parse(process.env.GOOGLE_SA_KEY);
    } catch (e) {
      console.error('[thumb.js] Invalid GOOGLE_SA_KEY JSON', e);
      return res.status(500).send('sa-key misconfigured');
    }
  } else {
    const keyPath = join(process.cwd(), 'api/drive/service-account.json');
    if (!existsSync(keyPath)) {
      console.error('[thumb.js] service-account.json not found');
      return res.status(500).send('sa-key missing');
    }
    try {
      key = JSON.parse(readFileSync(keyPath, 'utf8'));
    } catch (e) {
      console.error('[thumb.js] Error parsing service-account.json', e);
      return res.status(500).send('sa-key invalid');
    }
  }

  const auth  = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });

  // 1) fetch metadata so we know if this is a video
  let meta;
  try {
    const m = await drive.files.get({
      fileId: id,
      fields: 'mimeType,thumbnailLink'
    });
    meta = m.data;
    console.log(`[thumb.js]  metadata for ${id}:`, meta);
  } catch (err) {
    console.error('[thumb.js] failed to fetch metadata for thumb:', err);
    return res.status(500).send(`metadata error: ${err.message}`);
  }

  // 2) if it’s a video and Drive gave us a thumbnailLink, redirect there
  if (meta.mimeType?.startsWith('video/') && meta.thumbnailLink) {
    console.log(`[thumb.js] redirecting to Drive thumbnailLink for ${id}`);
    return res.redirect(meta.thumbnailLink);
  }

  // 3) VIDEO w/out Drive thumbnail → extract first frame via FFmpeg
  if (meta.mimeType?.startsWith('video/') && !meta.thumbnailLink) {
    console.log(`[thumb.js] no thumbnailLink, spawning FFmpeg for ${id}`);
    try {
      // 3.a) stream the *entire* video so FFmpeg can see the moov atom
      const { data: videoStream } = await drive.files.get(
        { fileId: id, alt: 'media' },
        { responseType: 'stream' }
      );

      // 3.b) spawn ffmpeg to grab one frame (with larger probe/analyze)
      const ff = spawn(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-probesize', '5000000',
        '-analyzeduration', '10000000',
        '-i', 'pipe:0',
        '-frames:v', '1',
        '-q:v', '2',
        '-f', 'image2',
        'pipe:1'
      ]);

      videoStream.pipe(ff.stdin);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      ff.stdout.pipe(res);

      ff.stderr.on('data', chunk => {
        console.error('[thumb.js][FFmpeg stderr]', chunk.toString());
      });
      ff.on('error', err => {
        console.error('[thumb.js] FFmpeg spawn error:', err);
        if (!res.headersSent) res.status(500).end(`ffmpeg error: ${err.message}`);
      });
    } catch (e) {
      console.error('[thumb.js] ffmpeg fallback crashed:', e);
      return res.status(500).send(`ffmpeg fallback error: ${e.message}`);
    }
    return;
  }

  // 4) fallback: stream the raw file bytes (images or unsupported videos)
  try {
    console.log(`[thumb.js] streaming raw bytes for ${id}`);
    const { data, headers } = await drive.files.get(
      { fileId: id, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    stream.pipeline(data, res, err => {
      if (err) {
        console.error('[thumb.js] thumb proxy error', err);
        if (!res.headersSent) res.status(500).end('stream failed');
      }
    });
  } catch (err) {
    console.error('[thumb.js] Drive thumb error', err.code, err.message);
    const code = err.code === 404 ? 404 : 500;
    res.status(code).send('thumb fetch failed');
  }
}
