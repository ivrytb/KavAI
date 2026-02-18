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

        console.log("--- שלב 1: הורדה מימות ---");
        const audioResp = await fetch(downloadUrl);
        const buffer = Buffer.from(await audioResp.arrayBuffer());

        console.log("--- שלב 2+3: העלאה לגוגל ---");
        const startUploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Header-Content-Type': 'audio/wav',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: 'AUDIO_RECORD' } })
        });

        const uploadUrl = startUploadResp.headers.get('x-goog-upload-url');
        const finalUploadResp = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Length': buffer.length.toString(),
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: buffer
        });

        const uploadData = await finalUploadResp.json();
        const fileUri = uploadData.file.uri;

        console.log("--- שלב 4: בקשת תשובה מ-Gemini 1.5 Flash ---");
        // כאן שיניתי ל-1.5 כדי שיהיה לך הרבה יותר מכסה
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "אתה עוזר קולי חכם בשם המוח. ענה בעברית. ללא גרשיים. נקודות הופכות לפסיקים כפולים (,,). ללא ירידות שורה. מקפים הופכים לרווח." },
                        { file_data: { mime_type: "audio/wav", file_uri: fileUri } }
                    ]
                }]
            })
        });

        const data = await response.json();
        if (data.error) throw new Error(`שגיאת API: ${data.error.message}`);

        let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "לא הצלחתי להבין";

        aiText = aiText
            .replace(/\n/g, " ")
            .replace(/["'״׳״]/g, "")
            .replace(/\*/g, "")
            .replace(/-/g, " ")
            .replace(/\./g, ",,")
            .replace(/[^\u0590-\u05FF0-9,!? ]/g, "")
            .trim();

        console.log("תשובה סופית:", aiText);

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send(`read=t-${aiText}=voice_result,,record,,,no,,,,20`);

    } catch (error) {
        console.error("שגיאה:", error.message);
        return res.status(200).send(`read=t-סליחה,, יש עומס על המערכת,, נסה שוב בעוד רגע=voice_result,,record,,,no,,,,20`);
    }
}
