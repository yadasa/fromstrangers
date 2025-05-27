// qr/api/drive/list.js

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  // load Service Account JSON from disk
  const keyPath = join(process.cwd(), 'api/drive/service-account.json');
  const key     = JSON.parse(readFileSync(keyPath, 'utf8'));

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  const drive    = google.drive({ version: 'v3', auth });
  const folderId = process.env.DRIVE_FOLDER_ID;

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
    fields: 'files(id,name,thumbnailLink,webContentLink,createdTime)',
    orderBy: 'createdTime desc'
  });

  res.status(200).json(response.data.files);
}
