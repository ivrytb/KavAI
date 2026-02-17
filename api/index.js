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

        // הורדת הקובץ
        const audioResponse = await fetch(downloadUrl);
        const arrayBuffer = await audioResponse.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        // שימוש ב-URL המדויק מה-Quickstart (v1beta/models/gemini-1.5-flash:generateContent)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "ענה בקצרה על השאלה מהאודיו,, ללא נקודות,, עברית בלבד" },
                        {
                            inlineData: {
                                mimeType: "audio/wav",
                                data: base64Audio
                            }
                        }
                    ]
                }],
                // הוספת הגדרות בטיחות כדי למנוע חסימות מיותרות
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        const data = await geminiResponse.json();

        // לוג לבדיקת המבנה שחוזר מגוגל
        console.log("Gemini Response Data:", JSON.stringify(data));

        if (data.error) {
            throw new Error(`Google Error ${data.error.code}: ${data.error.message}`);
        }

        if (!data.candidates || data.candidates.length === 0) {
            throw new Error("גוגל לא החזיר תשובה (ייתכן בגלל סינון בטיחות)");
        }

        const aiText = data.candidates[0].content.parts[0].text.replace(/\./g, ",,").trim();
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה סופית:", error.message);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-קרתה שגיאה,, ${error.message}=voice_result,,record,,,no,,,,20`);
    }
}
