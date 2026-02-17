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

        console.log("--- שלב 1: הורדה מימות ---");
        const audioResp = await fetch(downloadUrl);
        if (!audioResp.ok) throw new Error("קובץ לא נמצא בימות המשיח");
        const buffer = Buffer.from(await audioResp.arrayBuffer());
        const numBytes = buffer.length;

        console.log("--- שלב 2+3: העלאה לגוגל ---");
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

        console.log("--- שלב 4: בקשת תשובה מ-Gemini ---");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "אתה עוזר קולי חכם בשם המוח. ענה למשתמש בעברית. אל תשתמש בסימני פיסוק כלל חוץ מפסיקים. אל תשתמש בגרשיים, מקפים או ירידות שורה. ענה תשובה ממוקדת של עד 3-4 משפטים." },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });

        const data = await response.json();
        console.log("תגובה גולמית מגוגל:", JSON.stringify(data, null, 2));

        if (data.error) throw new Error(`שגיאת API: ${data.error.message}`);

        if (!data.candidates || data.candidates.length === 0) {
            throw new Error("לא התקבלו מועמדים לתשובה");
        }

        const candidate = data.candidates[0];
        if (candidate.finishReason === "SAFETY") {
            return res.status(200).send(`read=t-המערכת חסמה את התשובה מסיבות בטיחות=voice_result,,record,,,no,,,,20`);
        }

        let aiText = candidate.content?.parts?.[0]?.text || "לא הצלחתי להבין את האודיו";

        // --- ניקוי אגרסיבי לימות המשיח ---
        aiText = aiText
            .replace(/\n/g, " ")                // הסרת ירידות שורה
            .replace(/["'\"'״׳״]/g, "")         // הסרת כל סוגי הגרשיים
            .replace(/[.\-–—]/g, ",,")          // הפיכת נקודות ומקפים לפסיקים (הפסקה בקריינות)
            .replace(/[^\u0590-\u05FF0-9, ]/g, "") // השארת רק עברית, מספרים, פסיקים ורווחים
            .replace(/\s+/g, " ")               // הסרת רווחים כפולים
            .trim();

        console.log("תשובה מעובדת סופית:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        // המרה לפורמט URL-Safe שימות המשיח אוהבת
        const safeText = aiText.split(' ').join('+');
        
        return res.status(200).send(`read=t-${safeText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה:", error.message);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-חלה שגיאה,, ${error.message.replace(/\s+/g, '+')}=voice_result,,record,,,no,,,,20`);
    }
}
