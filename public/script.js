async function scanFrame() {
    if (!isScanning) return;

    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
        // Add loading indicator
        resultDiv.textContent = 'Scanning...';
        
        // Convert canvas to blob before processing
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg');
        });
        
        if (!blob) {
            throw new Error('Failed to create image blob');
        }

        const result = await Tesseract.recognize(blob, 'eng', {
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
        resultDiv.textContent = 'Error processing image: ' + err.message;
    }

    // Continue scanning
    setTimeout(scanFrame, 1000);
}
