import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    // מניעת כפילות פניות מהדפדפן
    if (req.url.includes('favicon')) {
        return res.status(200).send("");
    }

    const userId = req.query.ApiEnterID || req.query.ApiPhone || "guest";
    const voiceFileUrl = req.query.voice_result;

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `אתה עוזר אישי חכם למשפחה שומרת מצוות,,
        כללים חשובים:
        1,, שפה נקייה ומכובדת בלבד,,
        2,, אם המשתמש שואל על נושא לא צנוע או אסור, ענה: "כנראה שכחת,, אבל במשפחה שלנו לא מדברים על דברים כאלו,, ומנהלי הקו הכניסו אותי תחת מגבלות בנושא זה,, תרצה לדבר משהו אחר?"
        3,, אסור להשתמש בנקודות (.) בכלל בתשובה שלך,, במקום נקודה שים פסיק (,) או פסיק כפול (,,),,
        4,, תן תשובות קצרות שמתאימות להקראה טלפונית,,`
    });

    try {
        let aiResponseText = "";

        if (!voiceFileUrl) {
            // הודעת פתיחה בכניסה ראשונה
            aiResponseText = "שלום,, אני המוח של המערכת,, במה אוכל לעזור?";
        } else {
            // הורדת הקובץ מימות המשיח
            const response = await fetch(voiceFileUrl);
            const arrayBuffer = await response.arrayBuffer();
            const base64Data = Buffer.from(arrayBuffer).toString("base64");
            
            const chat = model.startChat({
                history: await redis.get(`chat_${userId}`) || [],
            });

            const result = await chat.sendMessage([
                {
                    inlineData: {
                        mimeType: "audio/wav",
                        data: base64Data
                    }
                },
                { text: "ענה למשתמש בקצרה וללא נקודות כלל" }
            ]);

            aiResponseText = result.response.text();
            
            // שמירת היסטוריה בזיכרון
            const history = await chat.getHistory();
            await redis.set(`chat_${userId}`, history.slice(-10), { ex: 3600 });
        }

        // ניקוי סופי של התשובה מנקודות ותווים בעייתיים
        const cleanResponse = aiResponseText.replace(/\./g, ",,")
                                         .replace(/["']/g, "");

        // בניית שורת הפקודה המושלמת כפי שסיכמנו
        const ymtCommand = `read=t-${cleanResponse}=voice_result,,record,,,no,,,15`;
        
        // שליחה כטקסט נקי בלבד
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(ymtCommand);

    } catch (error) {
        console.error("Error:", error);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send("read=t-סליחה,, קרתה שגיאה קטנה בחיבור,, נסה שוב בעוד רגע=voice_result,,record,,,no,,,15");
    }
}
