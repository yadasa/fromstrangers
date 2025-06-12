// api/drive/upload.js

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { google } from 'googleapis';

export const config = { api: { bodyParser: false } };

// Transcode helper
function transcodeVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inputPath,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'slow',
      '-c:a', 'aac', '-b:a', '128k',
      outputPath
    ];
    const ff = spawn(ffmpegPath, args, { stdio: 'ignore' });
    ff.on('error', reject);
    ff.on('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`FFmpeg exited with code ${code}`))
    );
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const form = new IncomingForm({
    keepExtensions: true,
    maxFileSize: 200 * 1024 * 1024
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Failed to parse form' });
    }

    // pick first file
    let raw = files.file ?? files[Object.keys(files)[0]];
    let fileArr = Array.isArray(raw) ? raw : [raw];
    const fileObj = fileArr[0];
    if (!fileObj) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // temp path
    const filePath = fileObj.filepath ?? fileObj.filePath ?? fileObj.path;
    if (!filePath) {
      console.error('Missing temp file path:', fileObj);
      return res.status(500).json({ error: 'Temporary file missing' });
    }

    const filename = fileObj.originalFilename || fileObj.newFilename || fileObj.name;
    const mimeType = fileObj.mimetype || fileObj.type;

    // load SA key
    let key;
    if (process.env.GOOGLE_SA_KEY) {
      try { key = JSON.parse(process.env.GOOGLE_SA_KEY); }
      catch (e) {
        console.error('Invalid GOOGLE_SA_KEY JSON', e);
        return res.status(500).json({ error: 'Invalid service account key' });
      }
    } else {
      const keyPath = path.join(process.cwd(), 'api/drive/service-account.json');
      try { key = JSON.parse(fs.readFileSync(keyPath, 'utf8')); }
      catch (e) {
        console.error('Missing/invalid service-account.json', e);
        return res.status(500).json({ error: 'Missing service-account.json' });
      }
    }

    // init Drive
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const drive = google.drive({ version: 'v3', auth });

    const FOLDER_ID = process.env.PROFILE_DRIVE_FOLDER_ID
                    || process.env.DRIVE_FOLDER_ID;
    if (!FOLDER_ID) {
      console.error('No DRIVE_FOLDER_ID or PROFILE_DRIVE_FOLDER_ID configured');
      return res.status(500).json({ error: 'Missing folder ID' });
    }

    // if video, transcode first
    let uploadPath = filePath;
    if (mimeType.startsWith('video/')) {
      const outName = `transcoded-${Date.now()}.mp4`;
      const outPath = path.join(os.tmpdir(), outName);
      try {
        await transcodeVideo(filePath, outPath);
        uploadPath = outPath;
      } catch (e) {
        console.error('Video transcoding failed:', e);
        return res.status(500).json({ error: 'Video transcoding error' });
      }
    }

    // upload to Drive
    try {
      const driveRes = await drive.files.create({
        requestBody: {
          name: filename,
          parents: [FOLDER_ID],
          appProperties: {
            owner:     fields.owner     || '',
            ownerName: fields.ownerName || ''
          }
        },
        media: {
          mimeType,
          body: fs.createReadStream(uploadPath)
        },
        fields: 'id,name,thumbnailLink,webContentLink,createdTime,appProperties'
      });

      // make public
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      return res.status(200).json(driveRes.data);
    } catch (err) {
      console.error('Drive upload error:', err);
      return res.status(500).json({ error: 'Drive API error' });
    } finally {
      // cleanup
      fs.unlink(filePath, () => {});
      if (uploadPath !== filePath) fs.unlink(uploadPath, () => {});
    }
  });
}
