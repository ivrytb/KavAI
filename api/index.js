import { GoogleGenerativeAI } from "@google/generative-ai";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    // 1. לוגים מפורטים לזיהוי הבעיה
    console.log("--- פנייה חדשה נכנסה ---");
    console.log("Method:", req.method); // האם זה GET או POST
    console.log("Query Params:", req.query); 
    console.log("Body Params:", req.body); // כאן כנראה מסתתר המידע

    if (req.url.includes('favicon')) return res.status(200).send("");

    // איחוד כל המקורות לפרמטרים (גם POST וגם GET)
    const params = { ...req.query, ...req.body };
    
    const userId = params.ApiPhone || params.ApiEnterID || "guest";
    const voiceFileUrl = params.voice_result;

    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `אתה עוזר אישי חכם למשפחה שומרת מצוות,, חוקים: 1,, שפה נקייה בלבד,, 2,, אסור נקודות (.) בכלל,, 3,, תשובות קצרות,,`
    });

    try {
        let aiResponseText = "";

        // בדיקה אם קיבלנו את הפרמטר voice_result
        if (!voiceFileUrl) {
            console.log("מצב: כניסה ראשונית (לא נמצא voice_result)");
            aiResponseText = "שלום,, אני המוח של המערכת,, במה אוכל לעזור?";
        } else {
            console.log("מצב: התקבלה הקלטה לעיבוד:", voiceFileUrl);
            
            const response = await fetch(voiceFileUrl);
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
        }

        const cleanResponse = aiResponseText.replace(/\./g, ",,").replace(/["']/g, "");
        
        // השורה המדויקת שביקשת
        const ymtCommand = `read=t-${cleanResponse}=voice_result,,record,,,no,,,,20`;
        
        console.log("תשובה נשלחת לימות:", ymtCommand);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(ymtCommand);

    } catch (error) {
        console.error("שגיאה:", error.message);
        return res.status(200).send("read=t-חלה שגיאה בעיבוד,, נסה שוב=voice_result,,record,,,no,,,,20");
    }
}
