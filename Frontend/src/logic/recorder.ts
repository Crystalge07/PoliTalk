
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let isRecording = false;
let isAnalyzing = false;
let playStartTime = 0;
const processedVideos = new Set<string>();

// Function to find the main video element
function findVideoElement(): HTMLVideoElement | null {
    const videos = document.querySelectorAll('video');
    let bestVideo: HTMLVideoElement | null = null;
    let maxVisibleHeight = 0;

    for (let video of Array.from(videos)) {
        const rect = video.getBoundingClientRect();

        // Calculate visible height in viewport
        const visibleTop = Math.max(0, rect.top);
        const visibleBottom = Math.min(window.innerHeight, rect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);

        if (visibleHeight > maxVisibleHeight && (video.src || video.currentSrc || video.querySelector('source'))) {
            maxVisibleHeight = visibleHeight;
            bestVideo = video;
        }
    }

    // Only return if at least 50% of the video is visible or it's the largest visible area
    if (bestVideo && maxVisibleHeight > 100) {
        return bestVideo;
    }
    return null;
}

async function sendVideoToBackend(blob: Blob, onResult: (data: any) => void, onError: (details?: string) => void) {
    if (blob.size === 0) {
        console.error("PoliTok: Recorded blob is empty.");
        onError("Empty recording");
        return;
    }
    console.log(`PoliTok: Sending video blob of size: ${blob.size} bytes`);

    const formData = new FormData();
    formData.append('video', blob, 'recording.webm');

    try {
        const response = await fetch('http://localhost:3000/analyze', {
            method: 'POST',
            body: formData
        });

        if (response.ok) {
            const result = await response.json();
            onResult(result);
        } else {
            let details = response.statusText;
            try {
                const errorData = await response.json();
                details = errorData.error_details || errorData.transcription || details;
            } catch (e) { }
            console.error("PoliTok: Backend error:", details);
            onError(details);
        }
    } catch (e: any) {
        console.error("PoliTok: Network error:", e);
        onError(e.message);
    }
}

export function setupPoliTok(
    onStatus: (status: string, details?: string) => void,
    onResult: (data: any) => void
) {
    const startRecording = (video: HTMLVideoElement) => {
        if (isRecording || isAnalyzing) return;

        const videoId = video.src || video.currentSrc || video.querySelector('source')?.getAttribute('src');
        if (!videoId || processedVideos.has(videoId)) return;

        // Reset buffer
        recordedChunks = [];
        processedVideos.add(videoId);

        try {
            // @ts-ignore
            const stream = video.captureStream();
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                onStatus('analyzing');
                isAnalyzing = true;
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                sendVideoToBackend(blob, (data) => {
                    onResult(data);
                    onStatus('idle');
                    isAnalyzing = false;
                }, (details) => {
                    onStatus('error', details);
                    isAnalyzing = false;
                });
                isRecording = false;
            };

            mediaRecorder.start();
            isRecording = true;
            onStatus('recording');

        } catch (e: any) {
            console.error("PoliTok: Error starting recording:", e);
            onStatus('error', e.message);
        }
    };

    const stopRecording = () => {
        if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
            isRecording = false;
        }
    };

    const interval = setInterval(() => {
        const video = findVideoElement();
        if (video) {
            // Check if we are already recording THIS specific video
            const videoId = video.src || video.currentSrc || video.querySelector('source')?.getAttribute('src');

            if (!(video as any).dataset.politokAttached) {
                (video as any).dataset.politokAttached = "true";
                if (!video.crossOrigin) video.crossOrigin = "anonymous";

                video.addEventListener('play', () => {
                    playStartTime = Date.now();
                });
            }

            // Detection logic
            if (!isRecording && !isAnalyzing && !processedVideos.has(videoId || '')) {
                // Wait for video to be playing and visible
                if (!video.paused && (Date.now() - playStartTime > 500)) {
                    startRecording(video);
                }
            }

            // Auto stop when video is near end
            if (isRecording && video.duration > 0) {
                const timeLeft = video.duration - video.currentTime;
                if (timeLeft <= 2.0 && timeLeft > 0.5) {
                    stopRecording();
                }
            }

            // If we scroll away significantly, stop recording
            const rect = video.getBoundingClientRect();
            if (isRecording && (rect.bottom < 100 || rect.top > window.innerHeight - 100)) {
                stopRecording();
            }

        } else {
            if (isRecording) stopRecording();
            if (!isAnalyzing) onStatus('no-video');
        }
    }, 500);

    return () => clearInterval(interval);
}
