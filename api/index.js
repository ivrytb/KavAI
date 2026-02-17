import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
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

        // טיפול במערך
        const actualPath = Array.isArray(voiceResult) ? voiceResult[voiceResult.length - 1] : voiceResult;
        
        // בניית הנתיב - מוודא שיש סלאש בתחילת הנתיב עבור ivr2:
        const formattedPath = actualPath.startsWith('/') ? actualPath : `/${actualPath}`;
        const downloadUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${YEMOT_TOKEN}&path=ivr2:${formattedPath}`;

        console.log("--- ניסיון הורדה ---");
        console.log("נתיב מקורי מימות:", actualPath);
        console.log("כתובת הורדה סופית:", downloadUrl);

        const response = await fetch(downloadUrl);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error("שגיאת שרת ימות:", response.status, errorText);
            throw new Error(`שגיאת הורדה ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log("הקובץ הורד בהצלחה, גודל:", arrayBuffer.byteLength);

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chat = model.startChat({
            history: await redis.get(`chat_${userId}`) || [],
        });

        const result = await chat.sendMessage([
            { inlineData: { mimeType: "audio/wav", data: Buffer.from(arrayBuffer).toString("base64") } },
            { text: "ענה בקצרה ללא נקודות" }
        ]);

        const aiText = result.response.text().replace(/\./g, ",,").replace(/["']/g, "");
        await redis.set(`chat_${userId}`, (await chat.getHistory()).slice(-10), { ex: 3600 });

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("קריסה בתהליך:", error.message);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-חלה שגיאה בעיבוד הקובץ,, נסו שוב בשאלה אחרת=voice_result,,record,,,no,,,,20`);
    }
}
