import Busboy from 'busboy';
import { Readable, pipeline } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.CONVERTHUB_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'Missing CONVERTHUB_API_KEY environment variable' });
  }

  const busboy = Busboy({ headers: req.headers });
  let fileBuffer = null;
  let filePromise = new Promise((resolve, reject) => {
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
      const chunks = [];
      file.on('data', data => chunks.push(data));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
      file.on('error', reject);
    });
    busboy.on('finish', () => {
      if (!fileBuffer) {
        reject(new Error('No file uploaded'));
      } else {
        resolve();
      }
    });
    busboy.on('error', reject);
  });

  req.pipe(busboy);

  try {
    await filePromise;
  } catch (err) {
    console.error('File parsing error:', err);
    return res.status(400).json({ error: 'File parsing failed: ' + err.message });
  }

  if (!fileBuffer) {
    return res.status(400).json({ error: 'No file received' });
  }

  try {
    const formData = new (globalThis.FormData || require('formdata-node').FormData)();
    formData.append('file', new Blob([fileBuffer], { type: 'video/webm' }), 'recording.webm');
    formData.append('target_format', 'gif');

    const convertRes = await fetch('https://api.converthub.com/v2/convert', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!convertRes.ok) {
      const errorText = await convertRes.text();
      console.error('Convert API error:', convertRes.status, errorText);
      return res.status(convertRes.status).json({ error: errorText || 'Conversion failed' });
    }

    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'attachment; filename="converted.gif"');

    // 使用缓冲方式确保完整返回 GIF 数据
    const buffer = await convertRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Conversion error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
}