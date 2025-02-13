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
            
            // Enhance image contrast with softer threshold
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // More sophisticated image processing
            const threshold = 160; // Increased from 128 for softer contrast
            const contrast = 1.2; // Contrast multiplier
            
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                // Apply contrast before threshold
                const adjusted = ((avg - 128) * contrast) + 128;
                // Softer thresholding
                const value = adjusted > threshold ? 255 : 
                             adjusted < threshold - 30 ? 0 : // Clear black
                             adjusted; // Keep grayscale for middle values
                
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
                // Updated Tesseract configuration
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                tessedit_pageseg_mode: '3', // Fully automatic page segmentation
                preserve_interword_spaces: '1'
            });

            console.log('Raw text found:', result.data.text);

            // Process text to find sail numbers
            const words = result.data.words;
            let potentialNumbers = [];

            // Process each word found in the image
            words.forEach(word => {
                // Remove any letters, keeping only numbers
                const numberOnly = word.text.replace(/[^0-9]/g, '');
                const confidence = word.confidence;

                // Check if we have a valid number (2-6 digits)
                if (numberOnly.length >= 2 && numberOnly.length <= 6) {
                    // Check for reversed numbers
                    const forward = parseInt(numberOnly);
                    const reversed = parseInt(numberOnly.split('').reverse().join(''));
                    
                    potentialNumbers.push({
                        number: forward,
                        confidence: confidence,
                        bbox: word.bbox,
                        isReversed: false
                    });

                    // Add reversed number if it's different
                    if (forward !== reversed) {
                        potentialNumbers.push({
                            number: reversed,
                            confidence: confidence,
                            bbox: word.bbox,
                            isReversed: true
                        });
                    }
                }
            });

            // Group similar numbers (handle both sides of sail)
            const groupedNumbers = [];
            potentialNumbers.forEach(num => {
                const existing = groupedNumbers.find(g => g.number === num.number);
                if (existing) {
                    // Keep the version with higher confidence
                    if (num.confidence > existing.confidence) {
                        existing.confidence = num.confidence;
                        existing.bbox = num.bbox;
                        existing.isReversed = num.isReversed;
                    }
                } else {
                    groupedNumbers.push(num);
                }
            });

            // Filter by confidence and sort by confidence
            const validNumbers = groupedNumbers
                .filter(num => num.confidence > 60)
                .sort((a, b) => b.confidence - a.confidence);

            if (validNumbers.length > 0) {
                console.log('Numbers found:', validNumbers);
                
                // Save all valid numbers found
                const numbersToSave = validNumbers.map(n => n.number);
                await saveNumbers(numbersToSave);
                
                // Display results
                resultDiv.textContent = `Detected sail numbers: ${numbersToSave.join(', ')}`;
                
                // Draw rectangles around detected numbers
                context.strokeStyle = 'red';
                context.lineWidth = 2;
                validNumbers.forEach(num => {
                    const { x0, y0, x1, y1 } = num.bbox;
                    context.strokeRect(x0, y0, x1-x0, y1-y0);
                    
                    // Add confidence label above rectangle
                    context.fillStyle = 'red';
                    context.font = '16px Arial';
                    context.fillText(
                        `${num.number} (${Math.round(num.confidence)}%)${num.isReversed ? ' R' : ''}`,
                        x0,
                        y0 - 5
                    );
                });
            } else {
                resultDiv.textContent = 'No valid sail numbers detected - try adjusting camera';
            }

            if (debugCheckbox.checked) {
                debugDiv.textContent = `Raw text: ${result.data.text}\n` +
                    `All potential numbers: ${JSON.stringify(potentialNumbers, null, 2)}\n` +
                    `Valid numbers: ${JSON.stringify(validNumbers, null, 2)}\n` +
                    `Processing time: ${Date.now() - startTime}ms`;
            }
        } catch (err) {
            console.error('Error processing image:', err);
            resultDiv.textContent = 'Error processing image: ' + err.message;
        }

        setTimeout(scanFrame, 8000);
    }

    document.getElementById('trainBtn').addEventListener('click', () => {
        document.getElementById('trainingModal').style.display = 'block';
    });

    async function submitTraining() {
        const imageFile = document.getElementById('trainImage').files[0];
        const correctNumber = document.getElementById('correctNumber').value;
        
        if (!imageFile || !correctNumber) {
            alert('Please select an image and enter the correct number');
            return;
        }

        const trainCanvas = document.getElementById('trainCanvas');
        const context = trainCanvas.getContext('2d');
        
        // Load and process image
        const img = new Image();
        img.onload = async () => {
            trainCanvas.width = img.width;
            trainCanvas.height = img.height;
            context.drawImage(img, 0, 0);

            // Apply same processing as live scan
            const imageData = context.getImageData(0, 0, trainCanvas.width, trainCanvas.height);
            const data = imageData.data;
            
            const threshold = 160;
            const contrast = 1.2;
            
            for (let i = 0; i < data.length; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                const adjusted = ((avg - 128) * contrast) + 128;
                const value = adjusted > threshold ? 255 : 
                             adjusted < threshold - 30 ? 0 : 
                             adjusted;
                
                data[i] = data[i + 1] = data[i + 2] = value;
            }
            context.putImageData(imageData, 0, 0);

            // Send to server
            try {
                const blob = await new Promise(resolve => trainCanvas.toBlob(resolve));
                const formData = new FormData();
                formData.append('image', blob);
                formData.append('number', correctNumber);

                const response = await fetch('/api/train', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    alert('Training data submitted successfully');
                    document.getElementById('trainingModal').style.display = 'none';
                } else {
                    throw new Error('Failed to submit training data');
                }
            } catch (error) {
                console.error('Training submission error:', error);
                alert('Error submitting training data');
            }
        };

        img.src = URL.createObjectURL(imageFile);
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
