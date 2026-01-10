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
app.use(cors());
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
            console.log('No speech detected in audio.');
            return res.json({
                transcription: "No speech detected.",
                bias_score: 5,
                bias_label: "No Speech Detected",
                key_terms: []
            });
        }

        // --- STEP 2: GEMINI BIAS ANALYSIS ---
        console.log('Analyzing bias with Gemini...');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                responseMimeType: "application/json",
            }
        });

        const prompt = `Analyze the political bias of this transcript from a social media video: "${transcription}"
        
        IMPORTANT: First, determine if the transcript contains any political or social-issue content. If it is purely entertainment, music, personal vlog, or otherwise non-political, set the bias_label to 'Non-Political', the bias_score to 5, and key_terms to an empty array.

        Bias Spectrum Reference:
        - 1-4 (Left/Progressive): Focus on social progress, systemic change, secularism, environmentalism, collective welfare, or progressive social justice.
        - 5 (Center/Neutral): Balanced, objective reporting, or non-partisan issues.
        - 6-10 (Right/Conservative): Focus on traditional values (e.g., traditional family roles, religious values), individual liberty, free markets, nationalism, or conservative social views.

        Based on the transcript, return a JSON object with:
        - bias_score (1-10)
        - bias_label (short string like 'Center-Left', 'Strong Right')
        - key_terms (MUST include at least 3-5 keywords if political, e.g., ['Traditionalism', 'Role of Women', 'Propaganda'])
        
        Response must be valid JSON only.`;

        const result = await model.generateContent(prompt);
        const text = result.response.text();

        let analysis;
        try {
            analysis = JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse Gemini JSON:', text);
            // Fallback: search for JSON-like block
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        }

        if (!analysis) {
            throw new Error('Could not get valid JSON from Gemini');
        }

        const responseData = {
            transcription: transcription,
            bias_score: analysis.bias_score || 5,
            bias_label: analysis.bias_label || "Neutral",
            key_terms: analysis.key_terms || []
        };

        console.log('Analysis complete:', responseData.bias_label);
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
