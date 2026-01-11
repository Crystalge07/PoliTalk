const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const port = 3000;

if (process.env.GEMINI_API_KEY) {
    console.log('Gemini API Key loaded successfully (starts with:', process.env.GEMINI_API_KEY.substring(0, 4) + '...)');
} else {
    console.error('CRITICAL ERROR: GEMINI_API_KEY not found in environment!');
}

if (process.env.ELEVENLABS_API_KEY) {
    console.log('ElevenLabs API Key loaded successfully (starts with:', process.env.ELEVENLABS_API_KEY.substring(0, 4) + '...)');
} else {
    console.warn('WARNING: ELEVENLABS_API_KEY not found in environment. Transcription will fail.');
}

// Middleware
app.use(cors({
    origin: '*', // Allow all origins (including browser extensions)
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        cb(null, 'temp_' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Analyze Endpoint
app.post('/analyze', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided.' });
    }

    const filePath = req.file.path;
    console.log('Video received:', filePath);

    let transcription = "";

    try {
        // --- STEP 1: ELEVENLABS TRANSCRIPTION ---
        console.log('Transcribing with ElevenLabs...');

        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        form.append('model_id', 'scribe_v2');
        // form.append('tag', 'politok'); // Optional

        const scribeResponse = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', form, {
            headers: {
                ...form.getHeaders(),
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        transcription = scribeResponse.data.text;
        console.log('Transcription complete:', transcription.substring(0, 50) + '...');

        if (!transcription || transcription.trim().length === 0) {
            console.log('No speech detected in audio - assuming non-political content (music/entertainment).');
            return res.json({
                transcription: "No speech detected.",
                bias_score: 5,
                bias_label: "Non-Political",
                key_terms: [],
                related_articles: []
            });
        }

        // --- STEP 2: GEMINI BIAS ANALYSIS ---
        console.log('Analyzing bias with Gemini...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                // JSON Mode cannot be used with Google Search Grounding
            },
            tools: [
                {
                    googleSearch: {},
                },
            ],
        });

        const prompt = `Analyze the political bias of this transcript from a social media video and find related real-world news: "${transcription}"
        
        CRITICAL: First determine if the content is POLITICAL or NON-POLITICAL:
        - NON-POLITICAL: Only for purely entertainment, music, personal vlogs, cooking, travel, lifestyle, or content with NO political/social commentary. These should have bias_label: 'Non-Political', bias_score: 5, and empty key_terms/related_articles.
        - POLITICAL: Any content discussing politics, government, social issues, elections, policies, current events, or political figures. Even if neutral/balanced, this is POLITICAL content and should use the bias spectrum below.

        Bias Spectrum (ONLY for POLITICAL content):
        - 1-4 (Left/Progressive): Focus on social progress, systemic change, secularism, collective welfare, or progressive social justice.
        - 5 (Center/Neutral): Balanced, objective political reporting, or non-partisan political issues. Use labels like 'Center', 'Neutral', 'Moderate', NOT 'Non-Political'.
        - 6-10 (Right/Conservative): Focus on traditional values, individual liberty, free markets, nationalism, or conservative social views.

        Based on the transcript, return a JSON object with:
        - bias_score (1-10) - For political content, use 1-10. For non-political, use 5.
        - bias_label (short string like 'Center-Left', 'Strong Right', 'Center', or 'Non-Political')
        - key_terms (MUST include 3-5 keywords if political content, empty array if non-political)
        - related_articles (CRITICAL RULES: 
            1. Provide articles if EITHER:
               a) The transcript discusses a SPECIFIC event with proper nouns (names, locations, dates), OR
               b) The transcript discusses a politically-charged topic (AI regulation, climate change, immigration, healthcare, gun control, etc.) with substantive commentary
            2. DO NOT provide articles for purely generic statements like "politics is crazy" or "things are changing"
            3. Articles MUST be directly related to the exact topic discussed - NO tangentially related articles
            4. It is ALWAYS better to return an empty array [] than to provide unrelated or loosely connected articles
            5. If providing articles, find exactly 3 from ONLY these trusted sources: Reuters, Associated Press, The Canadian Press, PBS NewsHour, NPR, Toronto Star, CBC, CPAC, BBC, Forbes, The Hill, MarketWatch, Morning Brew, Newsweek, Reason, Wall Street Journal
            6. Each article must have both 'title' and 'url' fields)
        
        Response must be valid JSON only.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        let analysis = null;
        try {
            // Attempt clean parse
            analysis = JSON.parse(text);
        } catch (e) {
            console.log('Attempting regex extraction for JSON...');
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    analysis = JSON.parse(jsonMatch[0]);
                } catch (innerE) {
                    console.error('Regex extraction failed to parse.');
                }
            }
        }

        // --- STEP 3: CONSTRUCT RESPONSE ---
        // If analysis failed entirely, provide a safe fallback
        if (!analysis) {
            console.log('Using safe fallback for analysis.');
            analysis = {
                bias_score: 5,
                bias_label: "Non-Political / Neutral",
                key_terms: [],
                related_articles: []
            };
        }

        // Filter out articles with missing URLs
        let validArticles = [];
        if (analysis.related_articles && Array.isArray(analysis.related_articles)) {
            validArticles = analysis.related_articles.filter(article => {
                if (!article || !article.url || !article.title) {
                    console.warn('Backend: Filtering invalid article:', article);
                    return false;
                }
                return true;
            });
        }

        const responseData = {
            transcription: transcription,
            topic: analysis.topic || "General Political Discussion",
            bias_score: analysis.bias_score || 5,
            bias_label: analysis.bias_label || "Neutral",
            key_terms: analysis.key_terms || [],
            related_articles: validArticles
        };

        console.log('Analysis complete:', responseData.bias_label);
        console.log('Valid articles:', validArticles.length);
        res.json(responseData);

    } catch (error) {
        console.error('Processing Error:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data));
        } else {
            console.error('Message:', error.message);
        }

        let label = "Analysis Error";
        let message = error.message;

        if (error.response && error.response.data) {
            message = JSON.stringify(error.response.data);
        }

        res.status(error.response?.status || 500).json({
            bias_score: 5,
            bias_label: label,
            key_terms: ["System Error"],
            transcription: "An error occurred during processing.",
            error_details: message
        });
    } finally {
        // Cleanup temp file
        fs.unlink(filePath, (err) => {
            if (err) console.error('Error deleting file:', filePath, err);
            else console.log('Deleted temp file:', filePath);
        });
    }
});

app.listen(port, () => {
    console.log(`PoliTok Backend running at http://localhost:${port}`);
});
