// api/drive/move.js
import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const { fileId } = req.body;
  if (!fileId) {
    return res.status(400).json({ error: 'Missing fileId in body' });
  }

  // Initialize Drive client
  const key = JSON.parse(process.env.GOOGLE_SA_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });

  try {
    // 1) Get current parents
    const getRes = await drive.files.get({
      fileId,
      fields: 'parents'
    });
    const oldParents = (getRes.data.parents || []).join(',');

    // 2) Move into deletions folder
    const deletionsId = process.env.DELETIONS_FOLDER_ID;
    const updRes = await drive.files.update({
      fileId,
      addParents: deletionsId,
      removeParents: oldParents,
      fields: 'id, parents'
    });

    return res.status(200).json({ success: true, parents: updRes.data.parents });
  } catch (err) {
    console.error('Drive move error:', err);
    return res.status(500).json({ error: 'Failed to move file' });
  }
}
