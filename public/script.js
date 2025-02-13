// ... existing code ...

async function scanFrame() {
    if (!isScanning) return;

    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
        // Add loading indicator
        resultDiv.textContent = 'Scanning...';
        
        const result = await Tesseract.recognize(canvas, 'eng', {
            logger: m => {
                // Show progress
                if (m.status === 'recognizing text') {
                    resultDiv.textContent = `Processing: ${Math.floor(m.progress * 100)}%`;
                }
            }
        });

        // Extract numbers from the text
        const numbers = result.data.text.match(/\d+/g);
        
        if (numbers && numbers.length > 0) {
            // Send numbers to backend
            await saveNumbers(numbers);
            resultDiv.textContent = `Detected numbers: ${numbers.join(', ')}`;
        } else {
            resultDiv.textContent = 'No numbers detected';
        }
    } catch (err) {
        console.error('Error processing image:', err);
        resultDiv.textContent = 'Error processing image';
    }

    // Continue scanning
    setTimeout(scanFrame, 1000);
}

// Add visual feedback for camera status
async function startScanning() {
    try {
        resultDiv.textContent = 'Starting camera...';
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });
        video.srcObject = videoStream;
        isScanning = true;
        resultDiv.textContent = 'Camera started. Beginning scan...';
        scanFrame();
    } catch (err) {
        console.error('Error accessing camera:', err);
        resultDiv.textContent = 'Error accessing camera. Please ensure you have granted camera permissions.';
    }



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
