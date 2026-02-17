import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    const userId = req.query.ApiEnterID || req.query.ApiPhone || "guest";
    const voiceFileUrl = req.query.voice_result;

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `אתה עוזר אישי למשפחה שומרת מצוות,,
        כללים חשובים ביותר:
        1,, שפה נקייה ומכובדת בלבד,,
        2,, אם המשתמש שואל על נושא לא צנוע או אסור, ענה: "כנראה שכחת,, אבל במשפחה שלנו לא מדברים על דברים כאלו,, ומנהלי הקו הכניסו אותי תחת מגבלות בנושא זה,, תרצה לדבר משהו אחר?"
        3,, חוק בל יעבור: אל תשתמש בנקודות (.) בכלל בתשובה שלך,, במקום נקודה בסוף משפט או באמצע, שים פסיק (,) או פסיק כפול (,,),,
        4,, תן תשובות קצרות שמתאימות להקראה בטלפון,,`
    });

    try {
        let aiResponseText = "";

        if (!voiceFileUrl) {
            aiResponseText = "שלום,, אני המוח של המערכת,, במה אוכל לעזור?";
        } else {
            // שימוש ב-fetch המובנה של Node.js
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
                { text: "ענה למשתמש בקצרה וללא נקודות" }
            ]);

            aiResponseText = result.response.text();
            
            const history = await chat.getHistory();
            await redis.set(`chat_${userId}`, history.slice(-10), { ex: 3600 });
        }

        const cleanResponse = aiResponseText.replace(/\./g, ",,");
        const ymtCommand = `read=text=${cleanResponse}&res_type=recording&val_name=voice_result&max=15&min=1`;
        
        res.status(200).send(ymtCommand);

    } catch (error) {
        console.error("Error details:", error);
        res.status(200).send("read=text=סליחה,, קרתה שגיאה קטנה בחיבור,, נסה שוב בעוד רגע");
    }
}
