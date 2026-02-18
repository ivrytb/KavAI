export default async function handler(req, res) {
    // איסוף פרמטרים מכל סוגי הבקשות (GET/POST)
    const params = { ...req.query, ...req.body };
    const voiceResult = params.voice_result;
    const API_KEY = process.env.GEMINI_API_KEY;
    const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

    // מניעת כפילויות של דפדפנים
    if (req.url.includes('favicon')) return res.status(200).send("");

    try {
        // שלב 0: בדיקה אם זו כניסה ראשונה או שיש כבר הקלטה
        if (!voiceResult) {
            console.log("--- כניסה חדשה: מבקש הקלטה מהמשתמש ---");
            return res.status(200).send(`read=t-שלום,, אני המוח,, איך אוכל לעזור היום?=voice_result,,record,,,no,,,,20`);
        }

        // חילוץ הנתיב של הקובץ שהוקלט
        const actualPath = Array.isArray(voiceResult) ? voiceResult[voiceResult.length - 1] : voiceResult;
        const formattedPath = actualPath.startsWith('/') ? actualPath : `/${actualPath}`;
        const downloadUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${YEMOT_TOKEN}&path=ivr2:${formattedPath}`;

        // שלב 1: הורדת הקובץ מימות המשיח
        console.log("--- 1. מוריד קובץ מימות המשיח ---");
        const audioResp = await fetch(downloadUrl);
        if (!audioResp.ok) throw new Error(`קובץ לא נמצא בנתיב: ${formattedPath}`);
        const buffer = Buffer.from(await audioResp.arrayBuffer());

        // שלב 2: פתיחת חיבור להעלאת קובץ לגוגל (Resumable Upload)
        console.log("--- 2. פותח חיבור העלאה לגוגל ---");
        const startUpload = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Header-Content-Type': 'audio/wav',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: 'USER_VOICE_INPUT' } })
        });

        const uploadUrl = startUpload.headers.get('x-goog-upload-url');
        if (!uploadUrl) {
            const errData = await startUpload.text();
            console.error("שגיאת העלאה מגוגל:", errData);
            throw new Error("גוגל סירב לקבל את הקובץ");
        }

        // שלב 3: העלאת הבינארי (הקובץ עצמו)
        console.log("--- 3. מעלה את האודיו בפועל ---");
        const finalUpload = await fetch(uploadUrl, {
            method: 'POST',
            headers: { 'X-Goog-Upload-Command': 'upload, finalize' },
            body: buffer
        });

        const uploadData = await finalUpload.json();
        const fileUri = uploadData.file.uri;
        console.log("נתיב קובץ בגוגל:", fileUri);

        // שלב 4: בקשת ניתוח ומענה מ-Gemini 2.5 Flash
        console.log("--- 4. מבקש תשובה מ-Gemini 2.5 Flash ---");
        // שימוש בדגם 2.5 פלאש - המאוזן ביותר למשימות כבדות בחינם
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "אתה עוזר אישי חכם בשם המוח. הקשב לאודיו וענה בעברית ברורה, קצרה ולעניין. אל תשתמש בגרשיים או סימנים מיוחדים. נקודות בסוף משפט הופכות לפסיקים כפולים (,,). ללא ירידות שורה." },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });

        const data = await response.json();

        // טיפול בשגיאות API
        if (data.error) {
            if (data.error.status === "RESOURCE_EXHAUSTED") {
                return res.status(200).send(`read=t-מצטער,, המוח עמוס כרגע ביותר מדי בקשות,, נסה שוב בעוד דקה=voice_result,,record,,,no,,,,20`);
            }
            throw new Error(data.error.message);
        }

        // חילוץ הטקסט מהתשובה
        let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הצלחתי להבין את ההקלטה";

        // שלב 5: ניקוי טקסט אגרסיבי לימות המשיח
        aiText = aiText
            .replace(/\n/g, " ")             // הסרת ירידות שורה
            .replace(/["'״׳]/g, "")          // הסרת כל סוגי הגרשיים
            .replace(/\*/g, "")              // הסרת כוכביות (של הדגשות)
            .replace(/-/g, " ")              // החלפת מקפים ברווח
            .replace(/\./g, ",,")            // החלפת נקודה בפסיק כפול להקראה טובה
            .replace(/[^\u0590-\u05FF0-9,!? ]/g, "") // השארת רק עברית, מספרים ופיסוק בסיסי
            .trim();

        console.log("--- תשובה סופית מוכנה ---:", aiText);

        // שליחת התשובה חזרה לימות המשיח עם בקשה להקלטה נוספת
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה קריטית במערכת:", error.message);
        // הודעת שגיאה רגועה למשתמש בטלפון
        return res.status(200).send(`read=t-חלה שגיאה זמנית בתקשורת עם המוח,, אנא נסו שוב=voice_result,,record,,,no,,,,20`);
    }
}
