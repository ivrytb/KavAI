export default async function handler(req, res) {
    const params = { ...req.query, ...req.body };
    const voiceResult = params.voice_result;
    const API_KEY = process.env.GEMINI_API_KEY;
    const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

    if (req.url.includes('favicon')) return res.status(200).send("");

    try {
        if (!voiceResult) {
            return res.status(200).send(`read=t-שלום,, אני המוח,, איך אוכל לעזור?=voice_result,,record,,,no,,,,20`);
        }

        const actualPath = Array.isArray(voiceResult) ? voiceResult[voiceResult.length - 1] : voiceResult;
        const formattedPath = actualPath.startsWith('/') ? actualPath : `/${actualPath}`;
        
        const downloadUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${YEMOT_TOKEN}&path=ivr2:${formattedPath}`;

        console.log("--- 1. מוריד קובץ מימות המשיח ---");
        const audioResp = await fetch(downloadUrl);
        if (!audioResp.ok) throw new Error("קובץ שמע לא נמצא בימות");
        const buffer = await audioResp.arrayBuffer();

        console.log("--- 2. פותח חיבור העלאה לגוגל ---");
        const startUpload = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': buffer.byteLength.toString(),
                'X-Goog-Upload-Header-Content-Type': 'audio/wav',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: 'AUDIO_INPUT' } })
        });

        const uploadUrl = startUpload.headers.get('x-goog-upload-url');
        if (!uploadUrl) throw new Error("לא התקבל URL להעלאה מגוגל");

        console.log("--- 3. מעלה את התוכן ליעד הסופי ---");
        const finalUpload = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Command': 'upload, finalize',
                'X-Goog-Upload-Offset': '0'
            },
            body: buffer
        });

        const uploadData = await finalUpload.json();
        
        // בדיקת בטיחות: האם הקובץ באמת עלה?
        if (!uploadData.file || !uploadData.file.uri) {
            console.error("תגובת גוגל להעלאה:", JSON.stringify(uploadData));
            throw new Error("העלאת הקובץ נכשלה - לא התקבל URI");
        }

        const fileUri = uploadData.file.uri;
        console.log("קובץ עלה בהצלחה:", fileUri);

        console.log("--- 4. מבקש תשובה מהמוח ---");
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { 
                            text: `אתה עוזר קולי ידידותי, חכם ואנושי בשם 'המוח'. 
                            הנחיות למענה:
                            1. ענה בעברית זורמת, חמה ומורחבת.
                            2. השתמש בשפה אנושית (לדוגמה: 'בשמחה', 'שאלה מעולה').
                            3. בכל סיום של תשובה, הצע המשך לשיחה או שאל שאלה כדי לעזור למשתמש.
                            4. ללא גרשיים בכלל.
                            5. נקודות הופכות לפסיקים כפולים (,,).
                            6. הכל בשורה אחת בלי ירידות שורה.` 
                        },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });

        const data = await geminiResponse.json();
        
        if (data.error) throw new Error(data.error.message);

        let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "סליחה,, לא הצלחתי להבין את ההקלטה,, אפשר לחזור על זה?";

        // ניקוי טקסט סופי
        aiText = aiText
            .replace(/\n/g, " ")
            .replace(/["'״׳]/g, "")
            .replace(/\*/g, "")
            .replace(/\./g, ",,")
            .trim();

        console.log("תשובה סופית:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("DEBUG ERROR:", error.message);
        return res.status(200).send(`read=t-מצטער,, חלה שגיאה בחיבור למוח,, נסו שוב בעוד רגע=voice_result,,record,,,no,,,,20`);
    }
}
