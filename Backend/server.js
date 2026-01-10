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
            mimeType: "video/webm",
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

        // 3. Generate Content
        const model = genAI.getGenerativeModel({
            model: "gemini-flash-latest",
        });

        const result = await model.generateContent([
            {
                fileData: {
                    mimeType: file.mimeType,
                    fileUri: file.uri
                }
            },
            { text: "Analyze this video for political bias. Determine: 1. A bias score (1-10, where 1 is strong left, 5 is center, 10 is strong right). 2. A bias label (e.g., 'Strong Left', 'Center-Right', etc.). 3. A list of key political terms or topics mentioned. 4. A brief transcription of the relevant speech. Return the result strictly as a JSON object with these keys: bias_score, bias_label, key_terms, transcription." }
        ]);

        const text = result.response.text();
        console.log('Gemini raw response:', text);

        // Extract JSON if wrapped in markdown
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

        if (!analysis) {
            throw new Error('Failed to parse Gemini response as JSON');
        }

        const responseData = {
            transcription: analysis.transcription || "No speech detected.",
            bias_score: analysis.bias_score || 5,
            bias_label: analysis.bias_label || "Neutral",
            key_terms: analysis.key_terms || []
        };

        console.log('Analysis complete:', responseData.bias_label);
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
