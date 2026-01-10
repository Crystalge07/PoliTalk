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
        // --- GEMINI INTEGRATION STUB ---
        // TODO: Integrate actual Google Gemini API here.
        // For now, we will return a mock response to test the flow.

        console.log('Processing video...');

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Mock Analysis
        const mockResult = {
            bias_score: Math.floor(Math.random() * 10) + 1, // 1-10
            bias_label: ['Left', 'Center', 'Right'][Math.floor(Math.random() * 3)],
            key_terms: ["inflation", "policy", "mock_term"]
        };

        console.log('Analysis complete:', mockResult);
        res.json(mockResult);

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
