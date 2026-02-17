import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    // זיהוי המשתמש לפי ה-ID או הטלפון מימות המשיח
    const userId = req.query.ApiEnterID || req.query.ApiPhone || "guest";
    const userSpeech = req.query.text;

    if (!userSpeech) {
        return res.status(200).send("read=text=שלום, אני המסיע האישי שלך. במה אוכל לעזור?");
    }

    try {
        // 1. שליפת היסטוריית השיחה מה-Redis
        let history = await redis.get(`chat_${userId}`) || [];
        
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: `אתה עוזר אישי חכם למשפחה שומרת מצוות. 
            כללים: 
            1. שפה נקייה ומכובדת בלבד.
            2. אם המשתמש שואל על נושא לא צנוע או אסור, ענה בדיוק: "כנראה שכחת... אבל במשפחה שלנו לא מדברים על דברים כאלו, ומנהלי הקו הכניסו אותי תחת מגבלות בנושא זה, תרצה לדבר משהו אחר?"
            3. אל תדבר על כפירה.
            4. תן תשובות קצרות שמתאימות להקראה בטלפון.`
        });

        // 2. יצירת שיחה עם היסטוריה
        const chat = model.startChat({ history: history });
        const result = await chat.sendMessage(userSpeech);
        const responseText = result.response.text();

        // 3. עדכון ההיסטוריה ושמירה (שומרים רק 10 הודעות אחרונות לחיסכון במקום)
        const updatedHistory = await chat.getHistory();
        await redis.set(`chat_${userId}`, updatedHistory.slice(-10), { ex: 3600 }); // נמחק אחרי שעה

        // 4. החזרה לימות המשיח
        res.status(200).send(`read=text=${responseText}&tts_lang=he`);

    } catch (error) {
        console.error(error);
        res.status(200).send("read=text=סליחה, המוח שלי קצת עמוס כרגע. נסה שוב בעוד רגע.");
    }
}
