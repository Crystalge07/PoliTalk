console.log("PoliTok: Content script loaded.");

let mediaRecorder;
let recordedChunks = [];
let isRecording = false;
let lastResult = null;

// Function to find the main video element
function findVideoElement() {
    const videos = document.querySelectorAll('video');
    for (let video of videos) {
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
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
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
    formData.append('video', blob, 'recording.webm');

    try {
        const response = await fetch('http://localhost:3000/analyze', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            console.log("PoliTok: Analysis Result:", result);
            lastResult = result;
            displayResult(result);
        } else {
            let errorMsg = `Backend error: ${response.statusText}`;
            try {
                const errJson = await response.json();
                if (errJson && errJson.error) errorMsg = errJson.error;
            } catch {}
            showErrorOverlay(errorMsg);
            console.error("PoliTok: Backend error:", errorMsg);
        }
    } catch (e) {
        showErrorOverlay("Network error: " + e.message);
        console.error("PoliTok: Network error:", e);
    }
}

function showErrorOverlay(message) {
    removeOverlay();
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
        <h3 style="margin: 0 0 10px 0;">PoliTok Error</h3>
        <p>${message}</p>
        <button id="politok-close" style="margin-top: 10px; background: #FE2C55; border: none; color: white; padding: 5px 10px; cursor: pointer;">Close</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('politok-close').onclick = () => {
        overlay.remove();
    };
}

function displayResult(data) {
    removeOverlay();

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
        <p><strong>Gemini Bias:</strong> ${data.bias_score}/10 (${data.bias_label})</p>
        ${data.roberta_bias ? `<p><strong>RoBERTa Leaning:</strong> ${data.roberta_bias.label} (${(data.roberta_bias.score * 100).toFixed(1)}%)</p>` : ''}
        <p><strong>Keywords:</strong> ${data.key_terms.join(', ')}</p>
        <button id="politok-close" style="margin-top: 10px; background: #FE2C55; border: none; color: white; padding: 5px 10px; cursor: pointer;">Close</button>
    `;

    document.body.appendChild(overlay);

    document.getElementById('politok-close').onclick = () => {
        overlay.remove();
    };
}

function removeOverlay() {
    const existingOverlay = document.getElementById('politok-overlay');
    if (existingOverlay) existingOverlay.remove();
}

// --- Main Observer Logic ---

let currentObserver = null;
let currentActiveVideo = null;

function setupObserver() {
    console.log("PoliTok: Starting Advanced Observer...");

    const options = {
        root: null,
        rootMargin: '0px',
        threshold: 0.6
    };

    const observerCallback = (entries, observer) => {
        entries.forEach(entry => {
            const video = entry.target;

            if (entry.isIntersecting) {
                console.log("PoliTok: Video entered viewport", video.src);
                handleNewVideo(video);
            } else {
                if (currentActiveVideo === video) {
                    console.log("PoliTok: Active video left viewport", video.src);
                    stopRecording();
                    video.style.border = "none";
                    currentActiveVideo = null;
                }
            }
        });
    };

    const observer = new IntersectionObserver(observerCallback, options);
    currentObserver = observer;

    observeAllVideos(observer);

    const domObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    if (node.tagName === 'VIDEO') {
                        observer.observe(node);
                    } else {
                        const videos = node.querySelectorAll('video');
                        videos.forEach(v => observer.observe(v));
                    }
                }
            });
        });
    });

    domObserver.observe(document.body, { childList: true, subtree: true });
}

function observeAllVideos(observer) {
    const videos = document.querySelectorAll('video');
    videos.forEach(v => observer.observe(v));
}

function handleNewVideo(video) {
    if (currentActiveVideo === video) return;

    if (currentActiveVideo) {
        currentActiveVideo.style.border = "none";
        if (isRecording) stopRecording();
    }

    currentActiveVideo = video;

    video.style.border = "4px solid #FE2C55";
    console.log("PoliTok: Locked onto new video.");

    video.addEventListener('play', () => {
        if (currentActiveVideo === video && !isRecording) {
            console.log("PoliTok: Video started playing. Recording...");
            startRecording(video);
        }
    });

    video.addEventListener('timeupdate', () => {
        if (currentActiveVideo !== video) return;
        if (isRecording && video.duration > 0) {
            const timeLeft = video.duration - video.currentTime;
            if (timeLeft <= 3.5 && timeLeft > 0.5) {
                console.log("PoliTok: Early stop.");
                stopRecording();
            }
        }
    });

    video.addEventListener('ended', () => {
        if (currentActiveVideo === video && isRecording) stopRecording();
    });

    if (!video.paused && !isRecording) {
        console.log("PoliTok: Video already playing. Recording...");
        startRecording(video);
    }
}

// --- Overlay Persistence Logic ---

function ensureOverlay() {
    if (lastResult && !document.getElementById('politok-overlay')) {
        displayResult(lastResult);
    }
}

const overlayObserver = new MutationObserver(() => {
    ensureOverlay();
});
overlayObserver.observe(document.body, { childList: true, subtree: true });

// Start