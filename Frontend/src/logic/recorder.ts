
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let isRecording = false;

// Function to find the main video element
function findVideoElement(): HTMLVideoElement | null {
    const videos = document.querySelectorAll('video');
    for (let video of Array.from(videos)) {
        // Simple heuristic: video must be visible in viewport
        const rect = video.getBoundingClientRect();
        const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
        if (isVisible && (video.src || video.querySelector('source') || video.currentSrc)) {
            return video;
        }
    }
    return null;
}

async function sendVideoToBackend(blob: Blob, onResult: (data: any) => void, onError: () => void) {
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
            console.error("PoliTok: Backend error:", response.statusText);
            onError();
        }
    } catch (e) {
        console.error("PoliTok: Network error:", e);
        onError();
    }
}

export function setupPoliTok(
    onStatus: (status: string) => void,
    onResult: (data: any) => void
) {
    const startRecording = (video: HTMLVideoElement) => {
        if (isRecording) return;

        try {
            // @ts-ignore
            const stream = video.captureStream();
            mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
            recordedChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                onStatus('analyzing');
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                sendVideoToBackend(blob, (data) => {
                    onResult(data);
                    onStatus('idle');
                }, () => onStatus('error'));
                isRecording = false;
            };

            mediaRecorder.start();
            isRecording = true;
            onStatus('recording');

        } catch (e) {
            console.error("PoliTok: Error starting recording:", e);
            onStatus('error');
        }
    };

    const stopRecording = () => {
        if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
    };

    const interval = setInterval(() => {
        const video = findVideoElement();
        if (video) {
            if (!(video as any).dataset.politokAttached) {
                (video as any).dataset.politokAttached = "true";

                // Crucial for captureStream check
                if (!video.crossOrigin) video.crossOrigin = "anonymous";

                video.addEventListener('play', () => {
                    if (!isRecording) startRecording(video);
                });

                video.addEventListener('timeupdate', () => {
                    if (isRecording && video.duration > 0) {
                        const timeLeft = video.duration - video.currentTime;
                        if (timeLeft <= 3.5 && timeLeft > 0.5) {
                            stopRecording();
                        }
                    }
                });

                video.addEventListener('ended', () => {
                    if (isRecording) stopRecording();
                });

                if (!video.paused && !isRecording) {
                    startRecording(video);
                }
            }
        } else {
            if (!isRecording) onStatus('no-video');
        }
    }, 1000);

    return () => clearInterval(interval);
}
