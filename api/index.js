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

        // 1. הורדת הקובץ מימות
        const audioResp = await fetch(downloadUrl);
        const audioBlob = await audioResp.blob();
        const buffer = Buffer.from(await audioBlob.arrayBuffer());

        // 2. העלאת הקובץ ל-Google File API (לפי התיעוד)
        console.log("מעלה קובץ לגוגל...");
        const uploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'X-Goog-Upload-Protocol': 'multipart' },
            body: buffer // שליחה כבינארי נקי
        });
        const uploadData = await uploadResp.json();
        const fileUri = uploadData.file.uri;

        // 3. שליחה ל-Gemini 2.0 Flash עם הקישור לקובץ
        console.log("מבקש תשובה מ-Gemini 2.0...");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "ענה בקצרה מאוד על השאלה מהאודיו. ללא נקודות, רק פסיקים." },
                        { fileData: { mimeType: "audio/wav", fileUri: fileUri } }
                    ]
                }]
            })
        });

        const data = await geminiResponse.json();
        
        if (data.error) throw new Error(data.error.message);

        const aiText = data.candidates[0].content.parts[0].text.replace(/\./g, ",,").trim();
        console.log("הצלחה!", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה:", error.message);
        return res.status(200).send(`read=t-חלה שגיאה,, ${error.message.includes('quota') ? 'נסה שוב בעוד דקה' : error.message}=voice_result,,record,,,no,,,,20`);
    }
}
