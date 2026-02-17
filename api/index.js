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

        // 1. הורדה
        const audioResp = await fetch(downloadUrl);
        if (!audioResp.ok) throw new Error("קובץ לא נמצא");
        const buffer = Buffer.from(await audioResp.arrayBuffer());

        // 2+3. העלאה לגוגל
        const startUpload = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Header-Content-Type': 'audio/wav',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: 'AUDIO' } })
        });

        const uploadUrl = startUpload.headers.get('x-goog-upload-url');
        const finalUpload = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: buffer
        });

        const uploadData = await finalUpload.json();
        const fileUri = uploadData.file.uri;

        // 4. בקשת תשובה
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "אתה עוזר קולי בשם המוח. ענה בעברית בלבד. אל תשתמש בסימני פיסוק חוץ מפסיקים. במקום נקודה שים פסיק. אל תשתמש בגרשיים או סוגריים. ענה תשובה ממוקדת של עד 4 משפטים כדי שלא תהיה ארוכה מדי." },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });

        const data = await response.json();
        let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הצלחתי להבין";

        // --- שלב הניקוי הקריטי לימות המשיח ---
        aiText = aiText
            .replace(/\n/g, " ")       // הסרת ירידות שורה
            .replace(/["'\"'״׳]/g, "") // הסרת כל סוגי הגרשיים
            .replace(/[.-]/g, ",,")     // הפיכת נקודות ומקפים לפסיקים להפסקה בקריינות
            .replace(/[^\u0590-\u05FF0-9, ]/g, "") // השארת רק עברית, מספרים ופסיקים (מסנן תווים מיוחדים)
            .replace(/\s+/g, " ")      // הסרת רווחים כפולים
            .trim();

        console.log("תשובה נקייה סופית:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        // חשוב: החלפת רווחים ב-plus כדי למנוע בעיות ב-URL
        const encodedText = aiText.split(' ').join('+');
        return res.status(200).send(`read=t-${encodedText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("Error:", error.message);
        return res.status(200).send(`read=t-חלה+שגיאה+במערכת=voice_result,,record,,,no,,,,20`);
    }
}
