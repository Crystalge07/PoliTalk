
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let isRecording = false;
let isAnalyzing = false;
let playStartTime = 0;
let recordingStartTime = 0;
const processedVideos = new Set<string>();

// Platform detection
function getPlatform(): 'tiktok' | 'instagram' | 'youtube' | 'unknown' {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('youtube.com')) return 'youtube';
    return 'unknown';
}

// Function to get platform-specific video selectors
function getPlatformVideoSelectors(platform: string): string[] {
    switch (platform) {
        case 'tiktok':
            // TikTok: all videos on the page
            return ['video'];
        case 'instagram':
            // Instagram: reels container videos, profile videos
            return [
                'video',
                'div[role="presentation"] video',
                'article video'
            ];
        case 'youtube':
            // YouTube: Shorts videos, regular videos
            return [
                'ytd-shorts-player video',
                'ytd-reel-video-renderer video',
                '#movie_player video',
                'video.html5-main-video'
            ];
        default:
            return ['video'];
    }
}

// Function to generate a unique video ID for tracking
function generateVideoId(video: HTMLVideoElement, platform: string): string {
    // Try to get src first
    const src = video.src || video.currentSrc || video.querySelector('source')?.getAttribute('src') || '';
    if (src) return src;

    // For videos without src (common when scrolling), use other attributes
    const parent = video.parentElement;
    
    switch (platform) {
        case 'tiktok':
            // Try to get data from parent containers
            const tiktokContainer = video.closest('[data-e2e*="video"], [class*="DivVideoContainer"]');
            if (tiktokContainer) {
                const containerId = tiktokContainer.getAttribute('data-e2e') || 
                                   tiktokContainer.className || 
                                   tiktokContainer.id;
                return `tiktok-${containerId}-${video.offsetTop}`;
            }
            break;
        case 'instagram':
            // Instagram often has article containers
            const instaArticle = video.closest('article');
            if (instaArticle) {
                const articleId = instaArticle.getAttribute('id') || 
                                 instaArticle.getAttribute('data-id') ||
                                 instaArticle.getAttribute('aria-label')?.slice(0, 50) ||
                                 'reel';
                return `instagram-${articleId}-${video.offsetTop}`;
            }
            break;
        case 'youtube':
            // YouTube has specific containers
            const ytContainer = video.closest('ytd-shorts-player, ytd-reel-video-renderer, #movie_player');
            if (ytContainer) {
                const containerId = ytContainer.id || 
                                   ytContainer.getAttribute('data-video-id') ||
                                   ytContainer.tagName;
                return `youtube-${containerId}-${video.offsetTop}`;
            }
            break;
    }

    // Fallback: use position and dimensions as ID
    const rect = video.getBoundingClientRect();
    return `${platform}-pos-${Math.round(rect.top)}-${Math.round(rect.left)}-${Date.now() % 10000}`;
}

// Function to find the main video element
function findVideoElement(): HTMLVideoElement | null {
    const platform = getPlatform();
    const selectors = getPlatformVideoSelectors(platform);
    
    // Collect all candidate videos from platform-specific selectors
    const candidateVideos: HTMLVideoElement[] = [];
    for (const selector of selectors) {
        try {
            const videos = Array.from(document.querySelectorAll<HTMLVideoElement>(selector));
            candidateVideos.push(...videos);
        } catch (e) {
            console.warn('PoliTok: Invalid selector:', selector, e);
        }
    }

    // Deduplicate videos
    const uniqueVideos = Array.from(new Set(candidateVideos));

    let bestVideo: HTMLVideoElement | null = null;
    let maxVisibleHeight = 0;

    for (let video of uniqueVideos) {
        const rect = video.getBoundingClientRect();

        // Skip hidden or very small videos
        if (rect.width < 50 || rect.height < 50) continue;

        // Calculate visible height in viewport
        const visibleTop = Math.max(0, rect.top);
        const visibleBottom = Math.min(window.innerHeight, rect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);

        // For scrolling feeds, prioritize videos that are playing or have significant visible area
        const isPlaying = !video.paused;
        const hasSignificantVisibleArea = visibleHeight > 100;
        const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;

        if ((isPlaying || hasSignificantVisibleArea) && isInViewport && visibleHeight > maxVisibleHeight) {
            maxVisibleHeight = visibleHeight;
            bestVideo = video;
        }
    }

    // Only return if at least 100px is visible
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
        // Provide more helpful error messages
        let errorMessage = e.message || "Network error";
        if (errorMessage.includes("Failed to fetch") || errorMessage.includes("fetch")) {
            errorMessage = "Backend server not running. Please start the server at localhost:3000";
        }
        onError(errorMessage);
    }
}

export function setupPoliTok(
    onStatus: (status: string, details?: string) => void,
    onResult: (data: any) => void
) {
    const startRecording = (video: HTMLVideoElement) => {
        if (isRecording || isAnalyzing) return;

        const platform = getPlatform();
        const videoId = generateVideoId(video, platform);
        if (!videoId || processedVideos.has(videoId)) return;

        // Reset buffer
        recordedChunks = [];
        recordingStartTime = Date.now();
        processedVideos.add(videoId);

        try {
            // @ts-ignore
            const stream = video.captureStream();

            // Validate that stream has tracks before creating MediaRecorder
            if (!stream || stream.getTracks().length === 0) {
                console.warn('PoliTok: No tracks available in stream, skipping recording');
                processedVideos.delete(videoId);
                return;
            }

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
            console.warn('PoliTok: Could not start recording (likely not on a video page):', e.message);
            processedVideos.delete(videoId);
            isRecording = false;
            // Don't show error to user - this is expected when navigating away from videos
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
            const platform = getPlatform();
            // Check if we are already recording THIS specific video
            const videoId = generateVideoId(video, platform);

            if (!(video as any).dataset.politokAttached) {
                (video as any).dataset.politokAttached = "true";
                if (!video.crossOrigin) video.crossOrigin = "anonymous";

                // Initialize playStartTime if video is already playing
                if (!video.paused) {
                    playStartTime = Date.now();
                }

                video.addEventListener('play', () => {
                    playStartTime = Date.now();
                });
            }

            // Detection logic - check if video is actually playing
            if (!isRecording && !isAnalyzing && !processedVideos.has(videoId)) {
                // Support all platforms: TikTok, Instagram, YouTube
                const isOnSupportedPlatform = platform === 'tiktok' || platform === 'instagram' || platform === 'youtube';
                
                // Check if video is playing
                const isVideoPlaying = !video.paused;
                
                if (isVideoPlaying) {
                    // Check if video has been playing for at least 500ms (to avoid false positives)
                    const timeSincePlayStart = playStartTime > 0 ? Date.now() - playStartTime : Infinity;
                    const hasPlayedLongEnough = timeSincePlayStart > 500;

                    // Also check if video has significant visible area (for scrolling feeds)
                    const rect = video.getBoundingClientRect();
                    const isSignificantlyVisible = rect.height > 200 && 
                        rect.top < window.innerHeight && 
                        rect.bottom > 0 &&
                        rect.width > 100;

                    // Start recording if on supported platform and video is playing
                    // Allow recording if video has played long enough OR if it's significantly visible (for scrolling feeds)
                    if (isOnSupportedPlatform && (hasPlayedLongEnough || isSignificantlyVisible)) {
                        startRecording(video);
                    }
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
