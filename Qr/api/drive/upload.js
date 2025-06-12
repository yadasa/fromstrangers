// api/drive/upload.js

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const form = new IncomingForm({
    keepExtensions: true,
    maxFileSize: 20 * 1024 * 1024
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Failed to parse form' });
    }

    // — pull the first file out of the array Formidable gives us —
    let raw = files.file ?? files[Object.keys(files)[0]];
    const fileArr = Array.isArray(raw) ? raw : [raw];
    const fileObj = fileArr[0];
    if (!fileObj) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // — robust fallback for the temp filepath —
    const filePath = fileObj.filepath
                  ?? fileObj.filePath
                  ?? fileObj.path;
    if (!filePath) {
      console.error('Missing temp file path in upload:', fileObj);
      return res.status(500).json({ error: 'Temporary file missing' });
    }

    const filename = fileObj.originalFilename || fileObj.newFilename || fileObj.name;
    const mimeType = fileObj.mimetype || fileObj.type;

    // —————— load service-account key ——————
    let key;
    if (process.env.GOOGLE_SA_KEY) {
      try {
        key = JSON.parse(process.env.GOOGLE_SA_KEY);
      } catch (e) {
        console.error('Invalid GOOGLE_SA_KEY JSON', e);
        return res.status(500).json({ error: 'Invalid service account key' });
      }
    } else {
      const keyPath = path.join(process.cwd(), 'api/drive/service-account.json');
      try {
        key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      } catch (e) {
        console.error('Missing/invalid service-account.json', e);
        return res.status(500).json({ error: 'Missing service-account.json' });
      }
    }

    // —————— init Drive client ——————
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const drive = google.drive({ version: 'v3', auth });

    // pick folder: PROFILE_DRIVE_FOLDER_ID, else DRIVE_FOLDER_ID, else dev fallback
    const FOLDER_ID = process.env.PROFILE_DRIVE_FOLDER_ID
                    || process.env.DRIVE_FOLDER_ID
                    || '1zmOhvhrskbhtnot2RD86MNU__6bmuxo2';
    if (!FOLDER_ID) {
      console.error('No DRIVE_FOLDER_ID or PROFILE_DRIVE_FOLDER_ID configured');
      return res.status(500).json({ error: 'Missing folder ID' });
    }

    try {
      // —————— upload to Drive ——————
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
          body: fs.createReadStream(filePath)
        },
        fields: 'id,name,thumbnailLink,webContentLink,createdTime,appProperties'
      });

      // —————— make it public ——————
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      // —————— return file info ——————
      return res.status(200).json(driveRes.data);
    } catch (err) {
      console.error('Drive upload error:', err);
      return res.status(500).json({ error: 'Drive API error' });
    } finally {
      // clean up temp file
      fs.unlink(filePath, () => {});
    }
  });
}
