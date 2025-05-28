// api/drive/upload.js
import formidable from 'formidable';
import fs from 'fs';
import { google } from 'googleapis';

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // 1) Parse the incoming form (fields.owner, fields.ownerName + files.file)
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ error: 'Failed to parse form' });
    }
    const file = files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // 2) Initialize Drive client
    const key = JSON.parse(process.env.GOOGLE_SA_KEY);
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    const drive = google.drive({ version: 'v3', auth });

    try {
      // 3) Upload into your main folder with appProperties
      const parent = process.env.DRIVE_FOLDER_ID;
      const media = {
        mimeType: file.mimetype,
        body: fs.createReadStream(file.filepath),
      };
      const driveRes = await drive.files.create({
        requestBody: {
          name: file.originalFilename,
          parents: [parent],
          appProperties: {
            owner:      fields.owner,
            ownerName:  fields.ownerName
          }
        },
        media,
        // include appProperties in the returned fields:
        fields: 'id,name,thumbnailLink,webContentLink,createdTime,appProperties'
      });

      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });


      

      return res.status(200).json(driveRes.data);
    } catch (driveErr) {
      console.error('Drive upload error:', driveErr);
      return res.status(500).json({ error: 'Failed to upload to Drive' });
    }
  });
}
