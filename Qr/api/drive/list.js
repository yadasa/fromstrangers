import { google } from 'googleapis';

export default async function handler(req, res) {
  // load your service account JSON from env
  const key = JSON.parse(process.env.GOOGLE_SA_KEY);

  // set up auth
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });

  const drive = google.drive({ version: 'v3', auth });
  const folderId = process.env.DRIVE_FOLDER_ID;

  // list non-trashed image files in that folder, newest first
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false and mimeType contains 'image/'`,
    fields: 'files(id,name,thumbnailLink,webContentLink,createdTime)',
    orderBy: 'createdTime desc'
  });

  res.status(200).json(response.data.files);
}
