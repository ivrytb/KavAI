import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    // לוג בסיסי לכל פנייה שנכנסת
    console.log("--- פנייה חדשה נכנסה ---");
    console.log("זמן:", new Date().toLocaleString('he-IL'));
    console.log("כל הפרמטרים שהתקבלו:", req.query);

    if (req.url.includes('favicon')) return res.status(200).send("");

    const userId = req.query.ApiEnterID || req.query.ApiPhone || "guest";
    const voiceFileUrl = req.query.voice_result;

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `אתה עוזר אישי למשפחה שומרת מצוות,, חוקים: 1,, שפה נקייה בלבד,, 2,, אסור נקודות (.) בכלל בתשובה,, 3,, תשובות קצרות,,`
    });

    try {
        let aiResponseText = "";

        if (!voiceFileUrl || voiceFileUrl === "") {
            console.log("לא זוהתה הקלטה (voice_result ריק) - שולח הודעת פתיחה");
            aiResponseText = "שלום,, אני המוח של המערכת,, במה אוכל לעזור?";
        } else {
            console.log("זוהתה הקלטה בכתובת:", voiceFileUrl);
            
            // הורדת הקובץ
            console.log("מתחיל להוריד קובץ שמע...");
            const response = await fetch(voiceFileUrl);
            if (!response.ok) throw new Error(`נכשל בהורדת קובץ: ${response.statusText}`);
            
            const arrayBuffer = await response.arrayBuffer();
            console.log("הקובץ הורד בהצלחה, גודל:", arrayBuffer.byteLength, "בייטים");

            const chat = model.startChat({
                history: await redis.get(`chat_${userId}`) || [],
            });

            console.log("שולח ל-Gemini לעיבוד...");
            const result = await chat.sendMessage([
                {
                    inlineData: {
                        mimeType: "audio/wav",
                        data: Buffer.from(arrayBuffer).toString("base64")
                    }
                },
                { text: "ענה בקצרה וללא נקודות" }
            ]);

            aiResponseText = result.response.text();
            console.log("תשובת Gemini המקורית:", aiResponseText);
            
            const history = await chat.getHistory();
            await redis.set(`chat_${userId}`, history.slice(-10), { ex: 3600 });
            console.log("היסטוריה נשמרה ב-Redis");
        }

        const cleanResponse = aiResponseText.replace(/\./g, ",,").replace(/["']/g, "");
        const ymtCommand = `read=t-${cleanResponse}=voice_result,,record,,,no,,,,20`;
        
        console.log("שולח לימות המשיח פקודה:", ymtCommand);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(ymtCommand);

    } catch (error) {
        console.error("!!! שגיאה בתהליך !!!");
        console.error("פירוט השגיאה:", error.message);
        
        // שליחת פקודה חלופית כדי שהשיחה לא תתנתק
        const errorCommand = `read=t-סליחה,, חלה שגיאה קטנה בעיבוד ההודעה,, נסה שוב כעת=voice_result,,record,,,no,,,,20`;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(errorCommand);
    }
}
