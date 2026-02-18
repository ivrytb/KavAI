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
        
        // שימוש ב-URL API המודרני למניעת שגיאות Deprecation
        const downloadUrl = new URL('https://www.call2all.co.il/ym/api/DownloadFile');
        downloadUrl.searchParams.append('token', YEMOT_TOKEN);
        downloadUrl.searchParams.append('path', `ivr2:${formattedPath}`);

        console.log("--- 1. מוריד קובץ מימות המשיח ---");
        const audioResp = await fetch(downloadUrl.toString());
        if (!audioResp.ok) throw new Error("קובץ שמע לא נמצא");
        const buffer = await audioResp.arrayBuffer();

        console.log("--- 2. מעלה לגוגל בשיטה היצירה ---");
        // מעלים ישירות בלי Resumable כדי למנוע את שגיאת ה-Missing X-
        const uploadResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'multipart',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                file: { display_name: "audio_input" }
            })
        });

        // הערה: בגלל המורכבות של Multipart ב-Fetch פשוט, נשתמש בטכניקה הכי בטוחה:
        // שלב א': יצירת המטה-דאטה
        // שלב ב': העלאת התוכן
        // אבל כדי לא להסתבך עם Multipart, נחזור ל-Resumable עם ה-Headers המדויקים שגוגל דורשת:

        const startUpload = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': buffer.byteLength.toString(),
                'X-Goog-Upload-Header-Content-Type': 'audio/wav',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: 'AUDIO' } })
        });

        const uploadUrl = startUpload.headers.get('x-goog-upload-url');
        if (!uploadUrl) {
            const errorText = await startUpload.text();
            throw new Error(`Google Error: ${errorText}`);
        }

        console.log("--- 3. מעלה את התוכן ליעד הסופי ---");
        const finalUpload = await fetch(uploadUrl, {
            method: 'POST', // גוגל מקבלת POST או PUT בכתובת הזו
            headers: {
                'X-Goog-Upload-Command': 'upload, finalize',
                'X-Goog-Upload-Offset': '0',
                'Content-Length': buffer.byteLength.toString()
            },
            body: buffer
        });

        const uploadData = await finalUpload.json();
        const fileUri = uploadData.file.uri;

        // 4. בקשת תשובה מ-Gemini 2.5 Flash עם הנחיות לסגנון אנושי
        console.log("--- 4. מבקש תשובה מ-Gemini 2.5 Flash (סגנון אנושי) ---");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { 
                            text: `אתה עוזר קולי ידידותי, חכם ואנושי בשם 'המוח'. 
                            הנחיות למענה:
                            1. ענה בעברית זורמת, חמה ומורחבת (לא קצרה מדי, אבל גם לא מגילות).
                            2. השתמש בשפה אנושית - אפשר להוסיף ביטויים כמו 'בשמחה', 'שאלה מצוינת', או 'מעניין מאוד'.
                            3. בכל סיום של תשובה, הצע המשך לשיחה או שאל שאלה רלוונטית כדי לעזור למשתמש להמשיך.
                            4. חשוב מאוד: אל תשתמש בגרשיים (") או סימנים מיוחדים.
                            5. נקודות בסוף משפטים הופכות לפסיקים כפולים (,,) כדי שההקראה תהיה טבעית.
                            6. ללא ירידות שורה בכלל.` 
                        },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });
        
        const data = await response.json();
        let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הבנתי";

        aiText = aiText.replace(/\n/g, " ").replace(/["'״׳]/g, "").replace(/\./g, ",,").trim();

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("DEBUG:", error.message);
        return res.status(200).send(`read=t-חלה שגיאה,, נסה שוב=voice_result,,record,,,no,,,,20`);
    }
}
