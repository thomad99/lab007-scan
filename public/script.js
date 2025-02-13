let isScanning = false;
let videoStream = null;

// Initialize the application
async function init() {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const resultDiv = document.getElementById('result');
    const debugCheckbox = document.getElementById('debugMode');
    const debugDiv = document.getElementById('debug');

    startBtn.addEventListener('click', startScanning);
    stopBtn.addEventListener('click', stopScanning);

    debugCheckbox.addEventListener('change', (e) => {
        debugDiv.classList.toggle('visible', e.target.checked);
    });

    video.addEventListener('play', () => {
        console.log('Video started playing');
    });

    video.addEventListener('error', (e) => {
        console.error('Video error:', e);
        resultDiv.textContent = 'Video error: ' + (video.error ? video.error.message : 'unknown error');
    });

    async function startScanning() {
        try {
            resultDiv.textContent = 'Starting camera...';
            console.log('Requesting camera access...');
            
            // Check if getUserMedia is supported
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Camera API is not supported in this browser');
            }

            const constraints = {
                video: { 
                    facingMode: "environment",
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };
            
            console.log('Camera constraints:', constraints);
            videoStream = await navigator.mediaDevices.getUserMedia(constraints);
            console.log('Camera access granted');
            
            video.srcObject = videoStream;
            video.onloadedmetadata = () => {
                console.log('Video metadata loaded');
                video.play();
            };
            
            isScanning = true;
            resultDiv.textContent = 'Camera started. Beginning scan...';
            scanFrame();
        } catch (err) {
            console.error('Error accessing camera:', err);
            resultDiv.textContent = 'Error accessing camera: ' + err.message + 
                '. Please ensure you have granted camera permissions.';
        }
    }

    function stopScanning() {
        isScanning = false;
        if (videoStream) {
            videoStream.getTracks().forEach(track => track.stop());
        }
        video.srcObject = null;
    }

    async function scanFrame() {
        if (!isScanning) return;

        const context = canvas.getContext('2d');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        try {
            resultDiv.textContent = 'Scanning image...';
            console.log('Starting scan of frame');
            
            // Enhance image contrast
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Increase contrast and convert to black and white
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                const threshold = 128;
                const value = avg > threshold ? 255 : 0;
                data[i] = data[i + 1] = data[i + 2] = value;
            }
            context.putImageData(imageData, 0, 0);

            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/jpeg', 1.0); // Maximum quality
            });
            
            if (!blob) {
                throw new Error('Failed to create image blob');
            }

            const startTime = Date.now();
            const result = await Tesseract.recognize(blob, 'eng', {
                logger: m => {
                    console.log('Tesseract status:', m.status, m.progress);
                    if (m.status === 'recognizing text') {
                        resultDiv.textContent = `Processing: ${Math.floor(m.progress * 100)}%`;
                    }
                },
                // Tesseract configuration for number recognition
                tessedit_char_whitelist: '0123456789',
                tessedit_pageseg_mode: '7', // Treat the image as a single text line
                preserve_interword_spaces: '0'
            });

            console.log('Raw text found:', result.data.text);

            // Process numbers with sail number specific rules
            const text = result.data.text.replace(/[^0-9]/g, ''); // Remove non-numbers
            const numberMatches = text.match(/\d{2,6}/g); // Match groups of 2-6 digits
            const groupedNumbers = numberMatches ? 
                numberMatches
                    .map(num => parseInt(num))
                    .filter(num => num >= 10 && num.toString().length <= 6) // Validate length
                : [];
            
            if (groupedNumbers.length > 0) {
                // Filter out low confidence matches
                const highConfidenceNumbers = groupedNumbers.filter((_, index) => 
                    result.data.confidence > 60 // Only keep numbers with >60% confidence
                );

                if (highConfidenceNumbers.length > 0) {
                    console.log('Numbers found:', highConfidenceNumbers);
                    await saveNumbers(highConfidenceNumbers);
                    resultDiv.textContent = `Detected sail numbers: ${highConfidenceNumbers.join(', ')}`;
                    
                    // Draw rectangles around detected numbers
                    const words = result.data.words;
                    context.strokeStyle = 'red';
                    context.lineWidth = 2;
                    for (const word of words) {
                        if (/^\d{2,6}$/.test(word.text)) { // Only highlight valid sail numbers
                            const { x0, y0, x1, y1 } = word.bbox;
                            context.strokeRect(x0, y0, x1-x0, y1-y0);
                        }
                    }
                } else {
                    resultDiv.textContent = 'Numbers detected but confidence too low';
                }
            } else {
                console.log('No valid sail numbers detected in frame');
                resultDiv.textContent = 'No valid sail numbers detected - try adjusting camera';
            }

            if (debugCheckbox.checked) {
                debugDiv.textContent = `Raw text: ${result.data.text}\n` +
                    `Grouped numbers: ${groupedNumbers.join(', ')}\n` +
                    `Confidence: ${result.data.confidence}%\n` +
                    `Processing time: ${Date.now() - startTime}ms`;
            }
        } catch (err) {
            console.error('Error processing image:', err);
            resultDiv.textContent = 'Error processing image: ' + err.message;
        }

        // Increase scan interval to 8 seconds to allow for better processing
        setTimeout(scanFrame, 8000);
    }
}

async function saveNumbers(numbers) {
    try {
        const response = await fetch('/api/numbers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ numbers })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save numbers');
        }
    } catch (err) {
        console.error('Error saving numbers:', err);
    }
}

// Start the application when the page loads
document.addEventListener('DOMContentLoaded', init); 
