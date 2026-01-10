console.log("PoliTok: Content script loaded.");

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// Function to find the main video element
function findVideoElement() {
    // TikTok usually has one main <video> element active
    // We can try to find the one that is playing
    const videos = document.querySelectorAll('video');
    for (let video of videos) {
        // Return the first video that has a source and isn't paused (or just the first one if unsure)
        // TikTok's structure can be dynamic, but usually the main feed video is prominent.
        // We might need a better heuristic, but let's start with this.
        if (video.src || video.querySelector('source')) {
            return video;
        }
    }
    return null;
}

// Function to start recording
function startRecording(video) {
    if (isRecording) return;

    console.log("PoliTok: Starting recording...");
    try {
        const stream = video.captureStream();
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' }); // Chrome supports webm out of box
        recordedChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            console.log("PoliTok: Recording stopped.");
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            sendVideoToBackend(blob);
            isRecording = false;
        };

        mediaRecorder.start();
        isRecording = true;

    } catch (e) {
        console.error("PoliTok: Error starting recording:", e);
    }
}

// Function to stop recording
function stopRecording() {
    if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

// Function to send video to backend
async function sendVideoToBackend(blob) {
    console.log("PoliTok: Sending video to backend...", blob.size);

    const formData = new FormData();
    // Re-encoding as MP4 might be done by backend or we just send WebM.
    // Frontend captureStream usually gives WebM.
    // The filename extension should probably be .webm
    formData.append('video', blob, 'recording.webm');

    try {
        const response = await fetch('http://localhost:3000/analyze', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            console.log("PoliTok: Analysis Result:", result);
            displayResult(result);
        } else {
            console.error("PoliTok: Backend error:", response.statusText);
        }
    } catch (e) {
        console.error("PoliTok: Network error:", e);
    }
}

// Simple Overlay Display (Placeholder)
function displayResult(data) {
    const existingOverlay = document.getElementById('politok-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.id = 'politok-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '20px';
    overlay.style.right = '20px';
    overlay.style.zIndex = '99999';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    overlay.style.color = 'white';
    overlay.style.padding = '15px';
    overlay.style.borderRadius = '10px';
    overlay.style.fontFamily = 'sans-serif';
    overlay.innerHTML = `
        <h3 style="margin: 0 0 10px 0;">PoliTok Analysis</h3>
        <p><strong>Bias Score:</strong> ${data.bias_score}/10</p>
        <p><strong>Leaning:</strong> ${data.bias_label}</p>
        <p><strong>Keywords:</strong> ${data.key_terms.join(', ')}</p>
        <button id="politok-close" style="margin-top: 10px; background: #FE2C55; border: none; color: white; padding: 5px 10px; cursor: pointer;">Close</button>
    `;

    document.body.appendChild(overlay);

    document.getElementById('politok-close').onclick = () => {
        overlay.remove();
    };
}


// --- Main Observer Logic ---

// We need to detect when a video starts playing and when it is about to end.
// TikTok uses a feed. We should observe the DOM for the *active* video.

function setupObserver() {
    // This is a naive implementation that checks every second for the active video
    // A better approach would be MutationObserver on the feed container.
    // But for "watching a specific video", we can attach listeners to the video elements we find.

    setInterval(() => {
        const video = findVideoElement();
        if (video) {
            // Check if we already attached our listener
            if (!video.dataset.politokAttached) {
                console.log("PoliTok: Found new video element.");
                video.dataset.politokAttached = "true";

                video.addEventListener('play', () => {
                    console.log("PoliTok: Video play.");
                    if (!isRecording) startRecording(video);
                });

                video.addEventListener('timeupdate', () => {
                    // Stop logic: 3-4 seconds before end
                    if (isRecording && video.duration > 0) {
                        const timeLeft = video.duration - video.currentTime;
                        // console.log("Time left:", timeLeft);
                        if (timeLeft <= 3.5 && timeLeft > 0.5) { // Stop roughly 3.5s before end, but not if we just started (sanity check)
                            console.log("PoliTok: Stopping early (3.5s remaining).");
                            stopRecording();
                        }
                    }
                });

                video.addEventListener('ended', () => {
                    if (isRecording) stopRecording();
                });

                // If it's already playing when we find it
                if (!video.paused && !isRecording) {
                    startRecording(video);
                }
            }
        }
    }, 1000);
}

setupObserver();
