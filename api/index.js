export default async function handler(req, res) {
    const params = { ...req.query, ...req.body };
    const voiceResult = params.voice_result;
    const API_KEY = process.env.GEMINI_API_KEY;
    const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

    if (req.url && req.url.includes('favicon')) return res.status(200).send("");

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

        // המרת הקובץ לפורמט Base64
        const base64Audio = Buffer.from(buffer).toString('base64');

        console.log("--- 2. מבקש תשובה מהמוח (Inline Data) ---");
        
        const models = [
            'gemini-2.0-flash',
            'gemini-1.5-flash',
            'gemini-1.5-flash-8b'
        ];

        let aiText = "";
        let success = false;

        for (const modelName of models) {
            if (success) break;
            
            console.log(`מנסה דגם: ${modelName}`);
            try {
                const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { 
                                    text: `אתה עוזר קולי ידידותי, חכם ואנושי בשם 'המוח'. ענה בעברית זורמת, חמה ומורחבת. השתמש בשפה אנושית. בכל סיום של תשובה, הצע המשך לשיחה או שאל שאלה. ללא גרשיים בכלל. נקודות הופכות לפסיקים כפולים (,,). הכל בשורה אחת בלי ירידות שורה.` 
                                },
                                { 
                                    inline_data: { 
                                        mime_type: "audio/wav", 
                                        data: base64Audio 
                                    } 
                                }
                            ]
                        }]
                    })
                });

                const data = await geminiResponse.json();

                if (data.error) {
                    console.warn(`דגם ${modelName} נכשל: ${data.error.message}`);
                    continue;
                }

                if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                    aiText = data.candidates[0].content.parts[0].text;
                    success = true;
                    console.log(`הצלחתי עם דגם: ${modelName}`);
                }
            } catch (err) {
                console.error(`שגיאה בגישה לדגם ${modelName}:`, err.message);
            }
        }

        if (!success) throw new Error("כל הדגמים נכשלו");

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
