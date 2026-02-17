export default async function handler(req, res) {
    const params = { ...req.query, ...req.body };
    const voiceResult = params.voice_result;
    const userId = params.ApiPhone || "guest";
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

        console.log("מוריד קובץ מנתיב:", formattedPath);
        const audioResponse = await fetch(downloadUrl);
        if (!audioResponse.ok) throw new Error("קובץ לא נמצא בימות המשיח");
        
        const arrayBuffer = await audioResponse.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        // שינוי לכתובת v1 היציבה
        console.log("שולח ל-Gemini API v1...");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "ענה בקצרה מאוד על השאלה מהאודיו,, ללא נקודות כלל,, רק פסיקים,, עברית בלבד,," },
                        { inlineData: { mimeType: "audio/wav", data: base64Audio } }
                    ]
                }]
            })
        });

        const data = await geminiResponse.json();
        
        if (data.error) {
            console.error("Gemini API Error Detail:", data.error);
            throw new Error(`גוגל החזיר שגיאה: ${data.error.message}`);
        }

        if (!data.candidates || !data.candidates[0]) {
            throw new Error("לא התקבלה תשובה מהבינה המלאכותית");
        }

        let aiText = data.candidates[0].content.parts[0].text;
        aiText = aiText.replace(/\./g, ",,").replace(/["']/g, "").trim();

        console.log("תשובה סופית:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה סופית במערכת:", error.message);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-חלה שגיאה בעיבוד,, ${error.message}=voice_result,,record,,,no,,,,20`);
    }
}
