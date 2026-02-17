export default async function handler(req, res) {
    const params = { ...req.query, ...req.body };
    const voiceResult = params.voice_result;
    const API_KEY = process.env.GEMINI_API_KEY;
    const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

    if (req.url.includes('favicon')) return res.status(200).send("");

    try {
        if (!voiceResult) {
            return res.status(200).send(`read=t-שלום,, אני המוח של המערכת,, במה אוכל לעזור?=voice_result,,record,,,no,,,,20`);
        }

        const actualPath = Array.isArray(voiceResult) ? voiceResult[voiceResult.length - 1] : voiceResult;
        const formattedPath = actualPath.startsWith('/') ? actualPath : `/${actualPath}`;
        const downloadUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${YEMOT_TOKEN}&path=ivr2:${formattedPath}`;

        // 1. הורדת הקובץ מימות המשיח
        console.log("מוריד קובץ מימות...");
        const audioResp = await fetch(downloadUrl);
        if (!audioResp.ok) throw new Error("קובץ לא נמצא בימות המשיח");
        const buffer = Buffer.from(await audioResp.arrayBuffer());
        const numBytes = buffer.length;

        // 2. שלב ראשון: התחלת העלאה (Initial resumable request)
        console.log("מתחיל העלאה לגוגל...");
        const startUploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': numBytes.toString(),
                'X-Goog-Upload-Header-Content-Type': 'audio/wav',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: 'AUDIO_RECORD' } })
        });

        const uploadUrl = startUploadResp.headers.get('x-goog-upload-url');
        if (!uploadUrl) throw new Error("לא התקבל URL להעלאה מגוגל");

        // 3. שלב שני: העלאת הבייטים בפועל
        console.log("מעלה בייטים...");
        const finalUploadResp = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Length': numBytes.toString(),
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: buffer
        });

        const uploadData = await finalUploadResp.json();
        const fileUri = uploadData.file.uri;
        console.log("קובץ הועלה בהצלחה:", fileUri);

        // 4. יצירת תשובה מהמודל (משתמשים ב-2.0 Flash)
        console.log("מבקש תשובה מ-Gemini 2.0...");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
        
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "ענה בקצרה מאוד על השאלה מהאודיו,, ללא נקודות כלל,, רק פסיקים,, עברית בלבד" },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });

        const data = await response.json();
        
        if (data.error) throw new Error(data.error.message);

        let aiText = data.candidates[0].content.parts[0].text;
        aiText = aiText.replace(/\./g, ",,").replace(/["']/g, "").trim();

        console.log("תשובה סופית:", aiText);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה בתהליך:", error.message);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-חלה שגיאה,, ${error.message}=voice_result,,record,,,no,,,,20`);
    }
}
