// Convert Blob to Base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Inject sidebar
function injectSidebar(videoEl) {
  if (videoEl._biasSidebarInjected) return;
  videoEl._biasSidebarInjected = true;

  const sidebar = document.createElement("div");
  sidebar.className = "bias-sidebar";
  sidebar.innerText = "Analyzing...";
  Object.assign(sidebar.style, {
    position: "absolute",
    top: "0",
    right: "0",
    backgroundColor: "rgba(255,255,255,0.9)",
    padding: "5px",
    zIndex: 1000,
    fontSize: "12px",
    maxWidth: "150px",
    wordWrap: "break-word"
  });

  videoEl.parentElement.style.position = "relative";
  videoEl.parentElement.appendChild(sidebar);
  return sidebar;
}

// Intersection Observer for videos
const observer = new IntersectionObserver(async (entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      const videoEl = entry.target;
      const sidebar = injectSidebar(videoEl);

      try {
        const response = await fetch(videoEl.src);
        const blob = await response.blob();
        const snippet = blob.slice(0, 8_000_000); // first 8MB
        const base64Audio = await blobToBase64(snippet);

        // Send to backend (not direct Gemini)
        const res = await fetch("https://YOUR_BACKEND_URL/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: base64Audio })
        });

        const data = await res.json();
        sidebar.innerText = `Bias: ${data.label}\nScore: ${(data.score*100).toFixed(0)}%\nKeywords: ${data.keywords.join(", ")}`;

      } catch (err) {
        console.error(err);
        sidebar.innerText = "Error analyzing audio";
      }
    }
  }
}, { threshold: 0.5 });

// Observe current and future videos
document.querySelectorAll("video").forEach(video => observer.observe(video));

const bodyObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    m.addedNodes.forEach(node => {
      if (node.tagName === "VIDEO") observer.observe(node);
      node.querySelectorAll?.("video").forEach(v => observer.observe(v));
    });
  }
});

bodyObserver.observe(document.body, { childList: true, subtree: true });