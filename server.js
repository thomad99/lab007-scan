const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const { ComputerVisionClient } = require('@azure/cognitiveservices-computervision');
const { CognitiveServicesCredentials } = require('@azure/ms-rest-azure-js');

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

// Define multer storage configurations
const trainUpload = multer({ 
    dest: 'training_data/',
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Add these environment variables in Render
const computerVisionKey = process.env.AZURE_VISION_KEY;
const computerVisionEndpoint = process.env.AZURE_VISION_ENDPOINT;

// Initialize Azure client
const computerVisionClient = new ComputerVisionClient(
    new CognitiveServicesCredentials(computerVisionKey),
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

// Update training endpoint to use trainUpload
app.post('/api/train', trainUpload.single('image'), async (req, res) => {
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
        console.log('Using Azure Computer Vision for OCR...');
        
        if (!req.file || !req.file.buffer) {
            throw new Error('No image file received');
        }

        console.log('Image received:', {
            size: req.file.size,
            mimetype: req.file.mimetype,
            bufferLength: req.file.buffer.length
        });

        console.log('Azure Endpoint:', computerVisionEndpoint);
        console.log('Azure Key configured:', computerVisionKey ? 'Yes (key hidden)' : 'No');

        // Call Azure Computer Vision API
        const result = await computerVisionClient.readInStream(
            req.file.buffer,
            { language: 'en' }
        );
        
        // Get operation location from the response
        const operationLocation = result.operationLocation;
        
        // Extract the operation ID from the operation location URL
        const operationId = operationLocation.split('/').pop();
        
        // Wait for the results
        let operationResult;
        do {
            operationResult = await computerVisionClient.getReadResult(operationId);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } while (operationResult.status === 'Running' || operationResult.status === 'NotStarted');

        console.log('Raw Azure Vision response:', operationResult);

        // Process the results with enhanced logic
        const detectedItems = [];
        const boxes = [];
        let allDetectedText = [];
        let rawText = '';

        if (operationResult.analyzeResult && operationResult.analyzeResult.readResults) {
            const readResults = operationResult.analyzeResult.readResults;
            
            // Get all raw text first
            allDetectedText = readResults.flatMap(page => page.lines.map(line => ({
                text: line.text,
                confidence: line.confidence || 0
            })));

            // Get raw text
            rawText = readResults.map(page => page.lines.map(line => line.text).join('\n')).join('\n');

            // Log all detected text
            console.log('All detected text:', allDetectedText);

            // Group nearby lines that might be part of the same sail number
            const lines = readResults.flatMap(page => page.lines);
            const groups = groupNearbyLines(lines);

            groups.forEach(group => {
                // Combine text from nearby lines
                const combinedText = group.map(line => line.text).join('');
                console.log('Processing group text:', combinedText);

                // Look for patterns that match sail numbers
                const numbers = extractSailNumbers(combinedText);
                
                numbers.forEach(number => {
                    // Validate the number is in reasonable range for sail numbers
                    if (isValidSailNumber(number)) {
                        detectedItems.push({
                            number: parseInt(number),
                            confidence: group[0].confidence || 0,
                            originalText: combinedText
                        });

                        // Create a bounding box that encompasses all lines in the group
                        const groupBox = calculateGroupBox(group);
                        boxes.push(groupBox);
                    }
                });
            });
        }

        // Filter and sort results with enhanced criteria
        const validNumbers = detectedItems
            .filter(item => item.confidence > 0.6)
            .sort((a, b) => b.confidence - a.confidence)
            .map(item => ({
                number: item.number,
                confidence: item.confidence,
                originalText: item.originalText
            }));

        console.log('Processed results:', validNumbers);

        res.json({
            numbers: validNumbers.map(v => v.number),
            boxes: boxes,
            debug: {
                rawText: rawText,
                allDetectedText: allDetectedText,
                detectedItems: detectedItems,
                validNumbers: validNumbers,
                rawResponse: {
                    status: operationResult.status,
                    createdDateTime: operationResult.createdDateTime,
                    lastUpdatedDateTime: operationResult.lastUpdatedDateTime,
                    analyzeResult: operationResult.analyzeResult
                }
            }
        });

    } catch (err) {
        console.error('Azure Vision error:', err);
        res.status(500).json({ error: 'Failed to process image: ' + err.message });
    }
});

// Helper function to group nearby lines
function groupNearbyLines(lines) {
    const groups = [];
    const used = new Set();

    lines.forEach((line, i) => {
        if (used.has(i)) return;

        const group = [line];
        used.add(i);

        // Look for nearby lines
        lines.forEach((otherLine, j) => {
            if (i !== j && !used.has(j) && areLinesNearby(line, otherLine)) {
                group.push(otherLine);
                used.add(j);
            }
        });

        groups.push(group);
    });

    return groups;
}

// Helper function to check if lines are nearby
function areLinesNearby(line1, line2) {
    const box1 = line1.boundingBox;
    const box2 = line2.boundingBox;
    
    // Calculate centers
    const center1Y = (box1[1] + box1[5]) / 2;
    const center2Y = (box2[1] + box2[5]) / 2;

    // Check vertical distance
    const verticalDistance = Math.abs(center1Y - center2Y);
    const averageHeight = (box1[5] - box1[1] + box2[5] - box2[1]) / 2;

    // Lines are nearby if they're within 1.5x the average height
    return verticalDistance < averageHeight * 1.5;
}

// Helper function to extract sail numbers
function extractSailNumbers(text) {
    // Remove common OCR mistakes
    const cleaned = text
        .replace(/[OoIl]/g, '0') // Replace common letter/number confusions
        .replace(/[^0-9]/g, ''); // Remove non-numbers

    // Look for number patterns
    const numbers = [];
    let current = '';
    
    for (let i = 0; i < cleaned.length; i++) {
        current += cleaned[i];
        if (current.length >= 2 && current.length <= 6) {
            numbers.push(current);
        }
    }

    return numbers;
}

// Helper function to validate sail numbers
function isValidSailNumber(number) {
    const num = parseInt(number);
    // Typical sail number ranges
    return num >= 10 && num <= 999999 && 
           number.length >= 2 && number.length <= 6;
}

// Helper function to calculate group bounding box
function calculateGroupBox(group) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    group.forEach(line => {
        const box = line.boundingBox;
        minX = Math.min(minX, box[0], box[2], box[4], box[6]);
        minY = Math.min(minY, box[1], box[3], box[5], box[7]);
        maxX = Math.max(maxX, box[0], box[2], box[4], box[6]);
        maxY = Math.max(maxY, box[1], box[3], box[5], box[7]);
    });

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
    };
}

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
