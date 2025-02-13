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
            resultDiv.textContent = 'Scanning image with Azure Vision...';
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
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to process image');
            }

            const result = await response.json();
            debugDiv.textContent += '\nReceived response from Azure';
            
            // Always show what Azure found, even if no valid sail numbers
            if (debugCheckbox.checked) {
                let debugText = `
=== Azure Vision Analysis ===
Time: ${new Date().toLocaleString()}
Status: ${result.debug.rawResponse.status}
Scan started: ${result.debug.rawResponse.createdDateTime}
Scan completed: ${result.debug.rawResponse.lastUpdatedDateTime}

=== Raw Text Found ===
${result.debug.rawText || 'No text found'}

=== All Text Items (Unfiltered) ===
${result.debug.allDetectedText.map(item => 
    `• "${item.text}" (${(item.confidence * 100).toFixed(1)}% confident)`
).join('\n')}

=== Number Processing ===
1. Text items found: ${result.debug.allDetectedText.length}
2. Potential numbers found: ${result.debug.detectedItems.length}
3. Valid sail numbers: ${result.debug.validNumbers.length}

=== Potential Numbers ===
${result.debug.detectedItems.map(item => 
    `• ${item.number} (from "${item.originalText}")
    - Confidence: ${(item.confidence * 100).toFixed(1)}%
    - Valid: ${isValidSailNumber(item.number) ? 'Yes' : 'No'}`
).join('\n') || 'None found'}

=== Final Valid Numbers ===
${result.debug.validNumbers.map(v => 
    `• ${v.number} (${(v.confidence * 100).toFixed(1)}% confident)`
).join('\n') || 'None found'}

=== Processing Notes ===
- Looking for numbers between 10 and 999999
- Minimum confidence threshold: 60%
- Converting O/o to 0, I/l to 1
                `.trim();

                debugDiv.textContent = debugText;
            }

            // Update the main result display
            if (result.numbers && result.numbers.length > 0) {
                console.log('Azure Vision found numbers:', result.numbers);
                await saveNumbers(result.numbers);
                resultDiv.textContent = `Azure detected sail numbers: ${result.numbers.join(', ')}`;
                
                // Draw detection boxes if coordinates are returned
                if (result.boxes) {
                    context.strokeStyle = 'red';
                    context.lineWidth = 2;
                    result.boxes.forEach(box => {
                        context.strokeRect(
                            box.x,
                            box.y,
                            box.width,
                            box.height
                        );
                    });
                }
            } else {
                resultDiv.textContent = 'Azure Vision: No valid sail numbers detected';
            }

        } catch (err) {
            console.error('Azure Vision error:', err);
            resultDiv.textContent = 'Azure Vision error: ' + err.message;
            if (debugCheckbox.checked) {
                debugDiv.textContent += '\nError: ' + err.message;
            }
        }

        // Show a countdown for next scan
        let countdown = 15;
        const updateCountdown = setInterval(() => {
            if (countdown > 0 && isScanning) {
                resultDiv.textContent += ` (Next scan in ${countdown}s)`;
                countdown--;
            } else {
                clearInterval(updateCountdown);
            }
        }, 1000);

        setTimeout(scanFrame, 15000);
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
