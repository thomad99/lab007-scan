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
            // Add loading indicator
            resultDiv.textContent = 'Scanning image...';
            console.log('Starting scan of frame');
            
            // Convert canvas to blob before processing
            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/jpeg', 0.95); // Higher quality JPEG
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
                }
            });

            // Log the raw text found
            console.log('Raw text found:', result.data.text);

            // Extract numbers from the text
            const numbers = result.data.text.match(/\d+/g);
            
            if (numbers && numbers.length > 0) {
                console.log('Numbers found:', numbers);
                // Send numbers to backend
                await saveNumbers(numbers);
                resultDiv.textContent = `Detected numbers: ${numbers.join(', ')}`;
                
                // Draw rectangles around detected numbers
                const words = result.data.words;
                context.strokeStyle = 'red';
                context.lineWidth = 2;
                for (const word of words) {
                    if (/\d+/.test(word.text)) {
                        const { x0, y0, x1, y1 } = word.bbox;
                        context.strokeRect(x0, y0, x1-x0, y1-y0);
                    }
                }
            } else {
                console.log('No numbers detected in frame');
                resultDiv.textContent = 'No numbers detected - try adjusting camera';
            }

            if (debugCheckbox.checked) {
                debugDiv.textContent = `Raw text: ${result.data.text}\n` +
                    `Confidence: ${result.data.confidence}%\n` +
                    `Processing time: ${Date.now() - startTime}ms`;
            }
        } catch (err) {
            console.error('Error processing image:', err);
            resultDiv.textContent = 'Error processing image: ' + err.message;
        }

        // Continue scanning with a longer delay (3 seconds)
        setTimeout(scanFrame, 3000);
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
