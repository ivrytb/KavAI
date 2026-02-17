import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const YEMOT_TOKEN = process.env.YEMOT_TOKEN;

export default async function handler(req, res) {
    if (req.url.includes('favicon')) return res.status(200).send("");

    const params = { ...req.query, ...req.body };
    const userId = params.ApiPhone || "guest";
    let voiceResult = params.voice_result;

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `אתה עוזר אישי חכם למשפחה שומרת מצוות,, חוקים: 1,, שפה נקייה בלבד,, 2,, אסור נקודות (.) בכלל,, 3,, תשובות קצרות,,`
    });

    try {
        let aiResponseText = "";

        if (!voiceResult) {
            aiResponseText = "שלום,, אני המוח של המערכת,, במה אוכל לעזור?";
        } else {
            // טיפול במערך קבצים - לוקחים את האחרון
            if (Array.isArray(voiceResult)) {
                voiceResult = voiceResult[voiceResult.length - 1];
            }

            // מוודא שהנתיב מתחיל בסלאש אחד בלבד
            const cleanPath = voiceResult.startsWith('/') ? voiceResult : `/${voiceResult}`;
            
            // בניית ה-URL המדויק לפי ההנחיה שלך
            const downloadUrl = `https://www.call2all.co.il/ym/api/DownloadFile?token=${YEMOT_TOKEN}&path=ivr2:${cleanPath}`;

            console.log("מנסה להוריד מהכתובת:", downloadUrl);

            const response = await fetch(downloadUrl);
            if (!response.ok) {
                console.error("שגיאת הורדה:", response.status);
                throw new Error("קובץ השמע לא נמצא בנתיב המבוקש");
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            const chat = model.startChat({
                history: await redis.get(`chat_${userId}`) || [],
            });

            const result = await chat.sendMessage([
                { 
                    inlineData: { 
                        mimeType: "audio/wav", 
                        data: Buffer.from(arrayBuffer).toString("base64") 
                    } 
                },
                { text: "ענה בקצרה ללא נקודות" }
            ]);

            aiResponseText = result.response.text();
            
            // שמירת היסטוריה מעודכנת
            const updatedHistory = await chat.getHistory();
            await redis.set(`chat_${userId}`, updatedHistory.slice(-10), { ex: 3600 });
        }

        const cleanResponse = aiResponseText.replace(/\./g, ",,").replace(/["']/g, "");
        const ymtCommand = `read=t-${cleanResponse}=voice_result,,record,,,no,,,,20`;
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(ymtCommand);

    } catch (error) {
        console.error("שגיאה בעיבוד:", error.message);
        return res.status(200).send("read=t-סליחה,, חלה שגיאה קטנה בגישה לקובץ ההקלטה,, נסה שוב=voice_result,,record,,,no,,,,20");
    }
}
