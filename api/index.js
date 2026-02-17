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
        console.log("--- שלב 1: הורדה מימות ---");
        const audioResp = await fetch(downloadUrl);
        if (!audioResp.ok) throw new Error("קובץ לא נמצא בימות המשיח");
        const buffer = Buffer.from(await audioResp.arrayBuffer());
        const numBytes = buffer.length;
        console.log(`הורדו ${numBytes} בייטים מהקלטה: ${formattedPath}`);

        // 2. שלב ראשון: התחלת העלאה לגוגל
        console.log("--- שלב 2: התחלת העלאה לגוגל ---");
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
        console.log("--- שלב 3: העלאת בייטים ---");
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
        console.log("קובץ הועלה בהצלחה ל-Gemini:", fileUri);

        // 4. בקשת תשובה מהמודל
        console.log("--- שלב 4: בקשת תשובה מ-Gemini 2.5 Flash ---");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "אתה עוזר קולי חכם ואדיב בשם 'המוח'. הקשב לאודיו המצורף וענה למשתמש בצורה מלאה, מפורטת ונעימה בעברית. אל תשתמש בסימני פיסוק כמו נקודות, במקום נקודה שים פעמיים פסיק (,,) כדי שהקריין יבין שזו הפסקה. תתנהג כמו בן אדם שמנהל שיחה זורמת." },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        }); // <--- כאן הייתה חסרה הסגירה!

        const data = await response.json();
        console.log("תגובה גולמית מגוגל:", JSON.stringify(data, null, 2));

        if (data.error) throw new Error(`שגיאת API: ${data.error.message}`);

        if (!data.candidates || data.candidates.length === 0) {
            throw new Error("לא התקבלו מועמדים לתשובה");
        }

        const candidate = data.candidates[0];
        
        if (candidate.finishReason === "SAFETY") {
            return res.status(200).send(`read=t-מצטער,, התוכן נחסם מסיבות בטיחות=voice_result,,record,,,no,,,,20`);
        }

        let aiText = candidate.content?.parts?.[0]?.text;
        
        if (!aiText) {
            aiText = "לא הצלחתי להבין את האודיו,, נסה שוב";
        } else {
            aiText = aiText.replace(/\./g, ",,").replace(/["']/g, "").trim();
        }

        console.log("תשובה מעובדת סופית:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה קריטית בתהליך:", error.message);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-חלה שגיאה במערכת,, ${error.message}=voice_result,,record,,,no,,,,20`);
    }
}
