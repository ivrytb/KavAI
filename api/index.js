import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
// אתחול ה-AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

export default async function handler(req, res) {
    const params = { ...req.query, ...req.body };
    const voiceResult = params.voice_result;
    const userId = params.ApiPhone || "guest";

    if (req.url.includes('favicon')) return res.status(200).send("");

    try {
        if (!voiceResult) {
            const welcome = "שלום,, אני המוח של המערכת,, במה אוכל לעזור?";
            return res.status(200).send(`read=t-${welcome}=voice_result,,record,,,no,,,,20`);
        }

        const actualPath = Array.isArray(voiceResult) ? voiceResult[voiceResult.length - 1] : voiceResult;
        const formattedPath = actualPath.startsWith('/') ? actualPath : `/${actualPath}`;
        const downloadUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${YEMOT_TOKEN}&path=ivr2:${formattedPath}`;

        console.log("מוריד קובץ...");
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`שגיאת הורדה ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const base64Audio = Buffer.from(arrayBuffer).toString("base64");

        // שינוי שם המודל לפורמט יציב יותר
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

        // שליחה ל-AI עם ה-Instruction בתוך ה-GenerateContent כדי למנוע בעיות גרסה
        const prompt = "אתה עוזר חכם למשפחה שומרת מצוות. ענה בקצרה מאוד על השאלה מהאודיו. אל תשתמש בנקודות בתשובה שלך, רק בפסיקים. השב בעברית.";
        
        const result = await model.generateContent([
            { text: prompt },
            {
                inlineData: {
                    mimeType: "audio/wav",
                    data: base64Audio
                }
            }
        ]);

        let aiText = result.response.text();
        
        // ניקוי תווים
        aiText = aiText.replace(/\./g, ",,").replace(/["']/g, "").trim();

        console.log("תשובת AI:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("קריסה בתהליך:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-חלה שגיאה בעיבוד הקול,, נסו שוב בשאלה אחרת=voice_result,,record,,,no,,,,20`);
    }
}
