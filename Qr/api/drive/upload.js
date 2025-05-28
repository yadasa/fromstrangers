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

  const form = new IncomingForm({ keepExtensions: true, maxFileSize: 20 * 1024 * 1024 });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Failed to parse form' });
    }

    const owner     = fields.owner;
    const ownerName = fields.ownerName;
    const file      = files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // ←────────── FIX: handle both v2 and v1 formidable paths ──────────→
    const filePath = file.filepath || file.path;
    const filename = file.originalFilename || file.newFilename || file.name;
    const mimeType = file.mimetype || file.type;

    // 2) Load service-account key
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
        console.error('Missing or invalid service-account.json', e);
        return res.status(500).json({ error: 'Missing service-account.json' });
      }
    }

    // 3) Init Drive client
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    const drive = google.drive({ version: 'v3', auth });

    try {
      // 4) Upload file
      const driveRes = await drive.files.create({
        requestBody: {
          name: filename,
          parents: [process.env.DRIVE_FOLDER_ID],
          appProperties: { owner, ownerName }
        },
        media: {
          mimeType,
          body: fs.createReadStream(filePath)
        },
        fields: 'id,name,thumbnailLink,webContentLink,createdTime,appProperties'
      });

      // 5) Make it publicly readable
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      return res.status(200).json(driveRes.data);
    } catch (uploadErr) {
      console.error('Drive upload error:', uploadErr);
      return res.status(500).json({ error: 'Failed to upload to Drive' });
    }
  });
}
