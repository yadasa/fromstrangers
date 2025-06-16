// api/drive/upload.js

import { IncomingForm } from 'formidable';
import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const form = new IncomingForm({
    keepExtensions: true,
    maxFileSize: 500 * 1024 * 1024 // Increased max file size
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Failed to parse form' });
    }

    // formidable v3 wraps fields in arrays, handle that.
    const getField = (fieldName) => {
        const value = fields[fieldName];
        return Array.isArray(value) ? value[0] : value;
    }

    // Pick the first file from the files object
    const fileKey = Object.keys(files)[0];
    const fileObj = files[fileKey]?.[0] || files[fileKey];
    
    if (!fileObj) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = fileObj.filepath;
    if (!filePath) {
      console.error('Missing temp file path:', fileObj);
      return res.status(500).json({ error: 'Temporary file missing' });
    }

    const filename = fileObj.originalFilename;
    const mimeType = fileObj.mimetype;
    
    // Load Service Account key
    let key;
    if (process.env.GOOGLE_SA_KEY) {
      try { key = JSON.parse(process.env.GOOGLE_SA_KEY); }
      catch (e) {
        console.error('Invalid GOOGLE_SA_KEY JSON', e);
        return res.status(500).json({ error: 'Invalid service account key' });
      }
    } else {
      const keyPath = path.join(process.cwd(), 'api/drive/service-account.json');
      if (!fs.existsSync(keyPath)) {
        return res.status(500).json({ error: 'Missing service-account.json' });
      }
      try { key = JSON.parse(fs.readFileSync(keyPath, 'utf8')); }
      catch (e) {
        console.error('Missing/invalid service-account.json', e);
        return res.status(500).json({ error: 'Invalid service-account.json' });
      }
    }

    // Initialize Drive client
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const drive = google.drive({ version: 'v3', auth });

    const FOLDER_ID = process.env.PROFILE_DRIVE_FOLDER_ID || process.env.DRIVE_FOLDER_ID;
    if (!FOLDER_ID) {
      console.error('No DRIVE_FOLDER_ID or PROFILE_DRIVE_FOLDER_ID configured');
      return res.status(500).json({ error: 'Missing server folder configuration' });
    }

    // *** REMOVED TRANSCODING FOR RELIABILITY ***
    // The original file is uploaded directly. This is much faster and less
    // prone to server timeouts. Google Drive will process the video on its end.
    const uploadPath = filePath;

    // Upload to Google Drive
    try {
      const driveRes = await drive.files.create({
        requestBody: {
          name: filename,
          parents: [FOLDER_ID],
          appProperties: {
            owner:     getField('owner') || '',
            ownerName: getField('ownerName') || ''
          }
        },
        media: {
          mimeType,
          body: fs.createReadStream(uploadPath)
        },
        // Request all the fields we might need on the client side
        fields: 'id, name, mimeType, thumbnailLink, webContentLink, createdTime, appProperties'
      });

      // Make the file publicly readable
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      // Return the full file metadata to the client
      return res.status(200).json(driveRes.data);

    } catch (err) {
      console.error('Drive upload error:', err);
      return res.status(500).json({ error: 'Drive API error during upload' });
    } finally {
      // Clean up the temporary file from the server
      fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
              console.error("Error deleting temp file", unlinkErr);
          }
      });
    }
  });
}
