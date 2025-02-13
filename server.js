const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { ApiKeyCredentials } = require('@azure/ms-rest-azure-js');

const app = express();
const port = process.env.PORT || 3000;

// Add general error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Add more detailed startup logging
console.log('Starting server...');
console.log('Node environment:', process.env.NODE_ENV);
console.log('Port:', port);

// Verify we have a DATABASE_URL
if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
}

// PostgreSQL connection configuration
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection on startup
pool.connect()
    .then(() => console.log('Successfully connected to database'))
    .catch(err => {
        console.error('Error connecting to database:', err);
        process.exit(1);
    });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'training_data/' });

// Add these environment variables in Render
const computerVisionKey = process.env.AZURE_VISION_KEY;
const computerVisionEndpoint = process.env.AZURE_VISION_ENDPOINT;

// Initialize Azure client
const computerVisionClient = new ComputerVisionClient(
    new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': computerVisionKey } }),
    computerVisionEndpoint
);

// API endpoint to save numbers
app.post('/api/numbers', async (req, res) => {
    const { numbers } = req.body;
    
    try {
        for (const number of numbers) {
            await pool.query(
                'INSERT INTO sail_numbers (number, timestamp) VALUES ($1, NOW())',
                [number]
            );
            console.log(`Saved number: ${number}`);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving to database:', err);
        res.status(500).json({ error: 'Failed to save numbers' });
    }
});

// Add test endpoint to view saved numbers
app.get('/api/numbers', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM sail_numbers ORDER BY timestamp DESC LIMIT 10'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching numbers:', err);
        res.status(500).json({ error: 'Failed to fetch numbers' });
    }
});

// Add training endpoint
app.post('/api/train', upload.single('image'), async (req, res) => {
    try {
        const { number } = req.body;
        const imagePath = req.file.path;
        
        // Store training data
        await pool.query(
            'INSERT INTO training_data (number, image_path, timestamp) VALUES ($1, $2, NOW())',
            [number, imagePath]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error saving training data:', err);
        res.status(500).json({ error: 'Failed to save training data' });
    }
});

// Add Azure processing endpoint
app.post('/api/scan', upload.single('image'), async (req, res) => {
    try {
        const imageBuffer = req.file.buffer;

        // Call Azure Computer Vision API
        const result = await computerVisionClient.recognizeText(imageBuffer, { language: 'en' });

        // Process the results
        const detectedItems = [];
        const boxes = [];

        if (result.lines) {
            for (const line of result.lines) {
                // Extract numbers from text
                const numbers = line.text.match(/\d{2,6}/g);
                if (numbers) {
                    numbers.forEach(number => {
                        detectedItems.push({
                            number: parseInt(number),
                            confidence: line.confidence || 0
                        });
                    });

                    // Save bounding box information
                    if (line.boundingBox) {
                        boxes.push({
                            x: line.boundingBox[0],
                            y: line.boundingBox[1],
                            width: line.boundingBox[2] - line.boundingBox[0],
                            height: line.boundingBox[3] - line.boundingBox[1]
                        });
                    }
                }
            }
        }

        // Filter and sort results
        const validNumbers = detectedItems
            .filter(item => item.confidence > 0.6)
            .sort((a, b) => b.confidence - a.confidence)
            .map(item => item.number);

        res.json({
            numbers: validNumbers,
            boxes: boxes
        });

    } catch (err) {
        console.error('Azure Vision error:', err);
        res.status(500).json({ error: 'Failed to process image' });
    }
});

// Make database connection more resilient
pool.on('error', (err) => {
    console.error('Unexpected database error:', err);
});

// Add more detailed health check
app.get('/health', (req, res) => {
    pool.query('SELECT NOW()')
        .then(() => {
            res.json({ 
                status: 'ok',
                timestamp: new Date().toISOString(),
                database: 'connected'
            });
        })
        .catch(err => {
            res.status(500).json({ 
                status: 'error',
                error: err.message,
                timestamp: new Date().toISOString()
            });
        });
});

// Add route to serve results page
app.get('/results', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'results.html'));
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Database URL: ${process.env.DATABASE_URL.split('@')[1]}`); // Only log the host part for security
}); 
