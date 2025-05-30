// api/drive/list.js
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  let key;
  if (process.env.GOOGLE_SA_KEY) {
    try {
      key = JSON.parse(process.env.GOOGLE_SA_KEY);
    } catch (e) {
      console.error("Invalid GOOGLE_SA_KEY JSON:", e);
      return res.status(500).send("Misconfigured GOOGLE_SA_KEY");
    }
  } else {
    const keyPath = join(process.cwd(), 'api/drive/service-account.json');
    if (!existsSync(keyPath)) {
      console.error("service-account.json not found");
      return res.status(500).send("Missing service-account.json");
    }
    try {
      key = JSON.parse(readFileSync(keyPath, 'utf8'));
    } catch (e) {
      console.error("Error parsing service-account.json:", e);
      return res.status(500).send("Invalid service-account.json");
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive = google.drive({ version: 'v3', auth });
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    console.error("DRIVE_FOLDER_ID not set");
    return res.status(500).json({ error: 'Missing DRIVE_FOLDER_ID' });
  }

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      // request id, name, thumbnailLink (for preview), webContentLink (for full image), timestamp, and any appProperties
      fields: 'files(id,name,thumbnailLink,webContentLink,createdTime,appProperties)',
      orderBy: 'createdTime desc'
    });
    return res.status(200).json(response.data.files);
  } catch (driveErr) {
    console.error("Drive list error:", driveErr);
    return res.status(500).send("Drive API error");
  }
}
