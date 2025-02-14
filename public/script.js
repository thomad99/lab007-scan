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
            
            // Wait for video to be ready
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    console.log('Video metadata loaded');
                    video.play();
                    resolve();
                };
            });

            // Wait additional 3 seconds for camera to stabilize
            resultDiv.textContent = 'Camera started. Waiting 3 seconds to stabilize...';
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            isScanning = true;
            resultDiv.textContent = 'Starting first scan...';
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

        try {
            const context = canvas.getContext('2d');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            resultDiv.textContent = 'Capturing image and sending to Azure...';
            debugDiv.textContent = 'Starting scan...';
            
            // Convert canvas to blob
            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/jpeg', 0.95);
            });

            // Send to backend for Azure processing
            const formData = new FormData();
            formData.append('image', blob);

            debugDiv.textContent += '\nSending image to Azure...';
            const response = await fetch('/api/scan', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Failed to process image');
            }

            resultDiv.textContent = 'Waiting for Azure analysis...';
            const result = await response.json();
            debugDiv.textContent += '\nReceived response from Azure';

            // Process sail numbers if found
            if (result.sailNumbers && result.sailNumbers.length > 0) {
                const validNumbers = result.sailNumbers
                    .filter(num => num.confidence > 0.6)
                    .map(num => num.number);

                if (validNumbers.length > 0) {
                    console.log('Found valid sail numbers:', validNumbers);
                    await saveNumbers(validNumbers);
                    resultDiv.textContent = `Found sail numbers: ${validNumbers.join(', ')}`;

                    // Draw boxes around detected numbers
                    context.strokeStyle = 'red';
                    context.lineWidth = 2;
                    result.sailNumbers.forEach(num => {
                        const box = num.boundingBox;
                        if (box) {
                            context.beginPath();
                            context.moveTo(box[0], box[1]);
                            for (let i = 2; i < box.length; i += 2) {
                                context.lineTo(box[i], box[i + 1]);
                            }
                            context.closePath();
                            context.stroke();
                        }
                    });
                } else {
                    resultDiv.textContent = 'No valid sail numbers detected';
                }
            } else {
                resultDiv.textContent = 'No sail numbers found in image';
            }

            // Show debug information if enabled
            if (debugCheckbox.checked) {
                debugDiv.innerHTML = `
=== Scan Results ===
Time: ${new Date().toLocaleString()}

Sail Numbers Found:
${result.sailNumbers?.length > 0 
    ? result.sailNumbers.map(num => 
        `• ${num.number} (${(num.confidence * 100).toFixed(1)}% confident)
         From text: "${num.originalText}"`
    ).join('\n')
    : 'None detected'}

All Text Found:
${result.rawText?.map(item => 
    `• "${item.text}" (${(item.confidence * 100).toFixed(1)}% confident)`
).join('\n') || 'No text found'}

Processing Time: ${result.processingTime}
Status: ${result.status}
                `.trim();
            }

        } catch (err) {
            console.error('Scan error:', err);
            resultDiv.textContent = 'Scan error: ' + err.message;
            if (debugCheckbox.checked) {
                debugDiv.textContent += '\nError: ' + err.message;
            }
        }

        // Wait 15 seconds before next scan
        if (isScanning) {
            resultDiv.textContent += '\nWaiting 15 seconds before next scan...';
            await new Promise(resolve => setTimeout(resolve, 15000));
            scanFrame();
        }
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

        console.log('Successfully saved numbers:', numbers);
    } catch (err) {
        console.error('Error saving numbers:', err);
        debugDiv.textContent += '\nFailed to save numbers to database';
    }
}

// Start the application when the page loads
document.addEventListener('DOMContentLoaded', init); 
