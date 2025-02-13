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
        console.log('=== Starting New Scan ===');
        
        if (!req.file || !req.file.buffer) {
            throw new Error('No image file received');
        }

        // STEP 1: Initial Image Upload
        console.log('Step 1: Image received', {
            size: `${(req.file.size / 1024).toFixed(2)} KB`,
            type: req.file.mimetype
        });

        // STEP 2: Send to Azure for Text Detection
        console.log('Step 2: Sending to Azure Vision...');
        const result = await computerVisionClient.readInStream(
            req.file.buffer,
            { language: 'en' }
        );
        
        // STEP 3: Wait for Azure Processing
        console.log('Step 3: Waiting for Azure analysis...');
        const operationId = result.operationLocation.split('/').pop();
        
        let operationResult;
        let attempts = 0;
        
        do {
            attempts++;
            operationResult = await computerVisionClient.getReadResult(operationId);
            console.log(`Attempt ${attempts}: Status = ${operationResult.status}`);
            
            if (operationResult.status !== 'Succeeded') {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } while (operationResult.status === 'Running' && attempts < 30);

        // STEP 4: Process What Azure Sees
        console.log('Step 4: Processing Azure results...');
        
        let analysis = {
            // A) What Azure sees in the image
            generalDescription: {
                allTextFound: [],
                totalItems: 0,
                description: ''
            },
            // B) Sail number specific analysis
            sailNumberAnalysis: {
                found: false,
                numbers: [],
                confidence: 0
            }
        };

        if (operationResult.analyzeResult && operationResult.analyzeResult.readResults) {
            const readResults = operationResult.analyzeResult.readResults;
            
            // A) Process everything Azure sees
            readResults.forEach((page, pageIndex) => {
                page.lines.forEach((line, lineIndex) => {
                    analysis.generalDescription.allTextFound.push({
                        text: line.text,
                        confidence: line.confidence,
                        location: `Line ${lineIndex + 1}`
                    });
                });
            });

            analysis.generalDescription.totalItems = analysis.generalDescription.allTextFound.length;
            analysis.generalDescription.description = `Found ${analysis.generalDescription.totalItems} text items in image`;

            // B) Look specifically for sail numbers
            const potentialNumbers = [];
            analysis.generalDescription.allTextFound.forEach(item => {
                const cleaned = item.text.replace(/[OoIl]/g, '0').replace(/[^0-9]/g, '');
                
                if (cleaned.length >= 2 && cleaned.length <= 6) {
                    const num = parseInt(cleaned);
                    if (num >= 10 && num <= 999999) {
                        potentialNumbers.push({
                            number: num,
                            confidence: item.confidence,
                            originalText: item.text,
                            location: item.location
                        });
                    }
                }
            });

            // Filter for high confidence sail numbers
            const validNumbers = potentialNumbers.filter(item => item.confidence > 0.6);
            
            analysis.sailNumberAnalysis = {
                found: validNumbers.length > 0,
                numbers: validNumbers,
                confidence: validNumbers.length > 0 ? 
                    Math.max(...validNumbers.map(n => n.confidence)) : 0
            };
        }

        // STEP 5: Send Back Detailed Results
        console.log('Step 5: Sending results...');
        console.log('Analysis Summary:', {
            textItemsFound: analysis.generalDescription.totalItems,
            sailNumbersFound: analysis.sailNumberAnalysis.numbers.length,
            hasSailNumber: analysis.sailNumberAnalysis.found
        });

        res.json({
            success: true,
            // A) What's in the image
            imageContents: {
                totalTextItems: analysis.generalDescription.totalItems,
                description: analysis.generalDescription.description,
                allTextFound: analysis.generalDescription.allTextFound
            },
            // B) Sail number results
            sailNumbers: {
                found: analysis.sailNumberAnalysis.found,
                numbers: analysis.sailNumberAnalysis.numbers,
                confidence: analysis.sailNumberAnalysis.confidence
            },
            // Debug info
            debug: {
                processingTime: `${attempts} seconds`,
                status: operationResult.status,
                rawResponse: operationResult.analyzeResult
            }
        });

    } catch (err) {
        console.error('Error during scan:', err);
        res.status(500).json({ 
            error: 'Scan failed: ' + err.message,
            details: err.stack
        });
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

// Update the analyze endpoint to wait longer
app.post('/api/analyze', upload.single('image'), async (req, res) => {
    try {
        console.log('Starting raw Azure Vision analysis...');
        
        if (!req.file || !req.file.buffer) {
            throw new Error('No image file received');
        }

        // Send to Azure
        const result = await computerVisionClient.readInStream(
            req.file.buffer,
            { language: 'en' }
        );
        
        // Wait for results with more attempts
        const operationId = result.operationLocation.split('/').pop();
        let operationResult;
        let attempts = 0;
        const maxAttempts = 60; // Wait up to 60 seconds
        
        do {
            attempts++;
            console.log(`Checking result attempt ${attempts}...`);
            operationResult = await computerVisionClient.getReadResult(operationId);
            
            if (operationResult.status === 'Failed') {
                throw new Error('Azure analysis failed');
            }
            
            if (operationResult.status !== 'Succeeded') {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } while (operationResult.status !== 'Succeeded' && attempts < maxAttempts);

        if (attempts >= maxAttempts) {
            throw new Error('Analysis timed out');
        }

        console.log('Analysis completed:', operationResult.status);

        // Process results
        const analysis = {
            rawText: [],
            detectedItems: []
        };

        if (operationResult.analyzeResult && operationResult.analyzeResult.readResults) {
            operationResult.analyzeResult.readResults.forEach(page => {
                page.lines.forEach(line => {
                    // Add raw text
                    analysis.rawText.push({
                        text: line.text,
                        confidence: line.confidence,
                        boundingBox: line.boundingBox
                    });

                    // Add detected items (words)
                    line.words?.forEach(word => {
                        analysis.detectedItems.push({
                            type: 'word',
                            text: word.text,
                            confidence: word.confidence,
                            boundingBox: word.boundingBox
                        });
                    });
                });
            });
        }

        res.json({
            success: true,
            rawText: analysis.rawText,
            detectedItems: analysis.detectedItems,
            processingTime: `${attempts} seconds`,
            status: operationResult.status,
            rawResponse: operationResult.analyzeResult
        });

    } catch (err) {
        console.error('Analysis error:', err);
        res.status(500).json({ 
            error: 'Analysis failed: ' + err.message,
            details: err.stack
        });
    }
});

// Add route to serve test page
app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`Database URL: ${process.env.DATABASE_URL.split('@')[1]}`); // Only log the host part for security
}); 
