// Qr/api/drive/list.js
import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  let key;

  // 1️⃣ Try the env var first (for Vercel prod)
  if (process.env.GOOGLE_SA_KEY) {
    try {
      key = JSON.parse(process.env.GOOGLE_SA_KEY);
    } catch (e) {
      console.error("Invalid JSON in GOOGLE_SA_KEY:", e);
      return res.status(500).send("Misconfigured GOOGLE_SA_KEY");
    }
  }
  // 2️⃣ Fallback to file on disk (for local dev)
  else {
    const keyPath = join(process.cwd(), 'api/drive/service-account.json');
    if (!existsSync(keyPath)) {
      console.error("service-account.json not found at", keyPath);
      return res.status(500).send("Missing service-account.json");
    }
    try {
      key = JSON.parse(readFileSync(keyPath, 'utf8'));
    } catch (e) {
      console.error("Error parsing service-account.json:", e);
      return res.status(500).send("Invalid service-account.json");
    }
  }

  //  Now initialize the Drive client
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const drive    = google.drive({ version: 'v3', auth });
  const folderId = process.env.DRIVE_FOLDER_ID;
  if (!folderId) {
    console.error("DRIVE_FOLDER_ID not set");
    return res.status(500).send("Missing DRIVE_FOLDER_ID");
  }

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: 'files(id,name,thumbnailLink,webContentLink,createdTime)',
      orderBy: 'createdTime desc'
    });
    return res.status(200).json(response.data.files);
  } catch (driveErr) {
    console.error("Drive API error:", driveErr);
    return res.status(500).send("Drive API error");
  }
}
