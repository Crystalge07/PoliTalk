const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
// const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const port = 3000;

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
        // Use timestamp to avoid collisions
        cb(null, 'temp_' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Analyze Endpoint
app.post('/analyze', upload.single('video'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided.' });
    }

    const filePath = req.file.path;
    console.log('Video received:', filePath);

    try {
        // --- GEMINI INTEGRATION ---

        // Initialize Gemini API
        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const { GoogleAIFileManager } = require("@google/generative-ai/server");

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);

        console.log('Processing video with Gemini...');

        // 1. Upload the file to Gemini
        const uploadResponse = await fileManager.uploadFile(filePath, {
            mimeType: "video/mp4",
            displayName: "PoliTok Upload " + Date.now(),
        });
        console.log(`Uploaded file ${uploadResponse.file.displayName} as: ${uploadResponse.file.uri}`);

        // 2. Wait for the file to be active
        let file = await fileManager.getFile(uploadResponse.file.name);
        while (file.state === "PROCESSING") {
            process.stdout.write(".");
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Sleep for 2 seconds
            file = await fileManager.getFile(uploadResponse.file.name);
        }
        console.log(`\nFile processing complete: ${file.state}`);

        if (file.state !== "ACTIVE") {
            throw new Error(`File processing failed. State: ${file.state}`);
        }

        // 3. Generate Content (Transcribe)
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
        });

        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: file.mimeType,
                    fileUri: file.uri
                }
            },
            { text: "Listen to the audio in this video and provide a full transcription of the speech. Return ONLY the transcription text, nothing else." }
        ]);

        const transcription = result.response.text();
        console.log('Transcription complete.');

        // Return the transcription
        // Adapting the original mock response structure to include transcription, 
        // effectively replacing the mock logic. 
        // NOTE: The original request asked to "listen and transcribe". 
        // The original mock returned bias_score, bias_label, key_terms. 
        // I will keep those as mocks for now OR try to derive them? 
        // The user specifically asked "to listen and transcribe". 
        // expecting the user might want just the transcription or the full analysis based on it.
        // For now I will return the transcription and keep the mock metadata for the frontend compatibility until asked otherwise,
        // OR better, I can ask Gemini for those too if I change the prompt.
        // Let's stick to the specific request: "listen and transcribe". 
        // But to not break the frontend expectation (server.js implies this endpoint returns bias info),
        // I should probably return the transcription as a field or just the text.
        // Looking at the previous code: it returned { bias_score, bias_label, key_terms }.
        // I'll add `transcription` to the response.

        const responseData = {
            transcription: transcription,
            // Keeping mock data for now to ensure frontend doesn't break if it expects these fields
            // In a real scenario, we should ask Gemini to generate these based on the transcription.
            bias_score: Math.floor(Math.random() * 10) + 1,
            bias_label: ['Left', 'Center', 'Right'][Math.floor(Math.random() * 3)],
            key_terms: ["inflation", "policy", "mock_term"]
        };

        console.log('Analysis complete');
        res.json(responseData);

    } catch (error) {
        console.error('Error processing video:', error);
        res.status(500).json({ error: 'Failed to analyze video.' });
    } finally {
        // --- CLEANUP ---
        // Delete the file after processing (success or fail)
        fs.unlink(filePath, (err) => {
            if (err) {
                console.error('Error deleting file:', filePath, err);
            } else {
                console.log('Successfully deleted temp file:', filePath);
            }
        });
    }
});

app.listen(port, () => {
    console.log(`PoliTok Backend running at http://localhost:${port}`);
});
