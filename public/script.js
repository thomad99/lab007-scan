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
            resultDiv.textContent = 'Scanning image with multiple filters...';
            console.log('Starting multi-filter scan');

            // Define different filter configurations
            const filterConfigs = [
                {
                    name: 'High Contrast B&W',
                    threshold: 150,
                    contrast: 1.5,
                    brightness: 10
                },
                {
                    name: 'Softer Contrast',
                    threshold: 160,
                    contrast: 1.2,
                    brightness: 0
                },
                {
                    name: 'Sharp Dark',
                    threshold: 140,
                    contrast: 1.8,
                    brightness: -10
                },
                {
                    name: 'Bright Sharp',
                    threshold: 170,
                    contrast: 1.6,
                    brightness: 20
                }
            ];

            let bestResult = null;
            let highestConfidence = 0;

            // Try each filter configuration
            for (const config of filterConfigs) {
                resultDiv.textContent = `Trying ${config.name} filter...`;
                console.log(`Processing with ${config.name}`);

                // Create a copy of the original image data
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = canvas.width;
                tempCanvas.height = canvas.height;
                const tempContext = tempCanvas.getContext('2d');
                tempContext.drawImage(canvas, 0, 0);

                // Apply this filter configuration
                const imageData = tempContext.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const data = imageData.data;

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    
                    const gray = (r * 0.299 + g * 0.587 + b * 0.114);
                    let adjusted = ((gray - 128) * config.contrast) + 128 + config.brightness;
                    
                    const localThreshold = config.threshold + (Math.random() * 20 - 10);
                    const value = adjusted > localThreshold ? 255 : 
                                 adjusted < (localThreshold - 50) ? 0 : 
                                 adjusted;
                    
                    data[i] = data[i + 1] = data[i + 2] = value;
                }
                tempContext.putImageData(imageData, 0, 0);

                // Process this version
                const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/jpeg', 1.0));
                
                const result = await Tesseract.recognize(blob, 'eng', {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            resultDiv.textContent = `${config.name}: ${Math.floor(m.progress * 100)}%`;
                        }
                    },
                    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
                    tessedit_pageseg_mode: '3',
                    preserve_interword_spaces: '1',
                    tessjs_create_pdf: '0',
                    tessjs_create_hocr: '0',
                    tessedit_do_invert: '0',
                    tessedit_enable_doc_dict: '0',
                    tessedit_unrej_any_wd: '1',
                    textord_heavy_nr: '1',
                    textord_min_linesize: '2.5',
                    tessedit_ocr_engine_mode: '2',
                    lstm_choice_mode: '2',
                    tessjs_image_enhance: '1'
                });

                // Process numbers from this result
                const numbers = processDetectedText(result.data);
                
                // Check if this result is better
                if (numbers.length > 0) {
                    const avgConfidence = numbers.reduce((sum, n) => sum + n.confidence, 0) / numbers.length;
                    if (avgConfidence > highestConfidence) {
                        highestConfidence = avgConfidence;
                        bestResult = {
                            numbers,
                            filteredCanvas: tempCanvas,
                            filterName: config.name
                        };
                    }
                }
            }

            // Use the best result
            if (bestResult) {
                console.log(`Best results from ${bestResult.filterName}:`, bestResult.numbers);
                
                // Copy the best filtered image to the main canvas
                context.drawImage(bestResult.filteredCanvas, 0, 0);
                
                // Save and display the numbers
                const numbersToSave = bestResult.numbers.map(n => n.number);
                await saveNumbers(numbersToSave);
                
                resultDiv.textContent = `Detected sail numbers: ${numbersToSave.join(', ')} (using ${bestResult.filterName})`;
                
                // Draw rectangles and confidence levels
                drawDetectionBoxes(context, bestResult.numbers);

                if (debugCheckbox.checked) {
                    debugDiv.textContent = `Best filter: ${bestResult.filterName}\n` +
                        `Numbers found: ${JSON.stringify(bestResult.numbers, null, 2)}\n` +
                        `Average confidence: ${highestConfidence.toFixed(1)}%`;
                }
            } else {
                resultDiv.textContent = 'No valid sail numbers detected with any filter';
            }

        } catch (err) {
            console.error('Error processing image:', err);
            resultDiv.textContent = 'Error processing image: ' + err.message;
        }

        // Wait longer between scans since we're doing multiple processes
        setTimeout(scanFrame, 15000);
    }

    // Helper function to process detected text
    function processDetectedText(data) {
        const words = data.words;
        let potentialNumbers = [];

        words.forEach(word => {
            const numberOnly = word.text.replace(/[^0-9]/g, '');
            const confidence = word.confidence;

            if (numberOnly.length >= 2 && numberOnly.length <= 6) {
                const forward = parseInt(numberOnly);
                const reversed = parseInt(numberOnly.split('').reverse().join(''));
                
                potentialNumbers.push({
                    number: forward,
                    confidence: confidence,
                    bbox: word.bbox,
                    isReversed: false
                });

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

        // Group and filter numbers
        const groupedNumbers = [];
        potentialNumbers.forEach(num => {
            const existing = groupedNumbers.find(g => g.number === num.number);
            if (existing) {
                if (num.confidence > existing.confidence) {
                    existing.confidence = num.confidence;
                    existing.bbox = num.bbox;
                    existing.isReversed = num.isReversed;
                }
            } else {
                groupedNumbers.push(num);
            }
        });

        return groupedNumbers
            .filter(num => num.confidence > 45)
            .sort((a, b) => b.confidence - a.confidence);
    }

    // Helper function to draw detection boxes
    function drawDetectionBoxes(context, numbers) {
        context.strokeStyle = 'red';
        context.lineWidth = 2;
        numbers.forEach(num => {
            const { x0, y0, x1, y1 } = num.bbox;
            context.strokeRect(x0, y0, x1-x0, y1-y0);
            
            context.fillStyle = 'red';
            context.font = '16px Arial';
            context.fillText(
                `${num.number} (${Math.round(num.confidence)}%)${num.isReversed ? ' R' : ''}`,
                x0,
                y0 - 5
            );
        });
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
