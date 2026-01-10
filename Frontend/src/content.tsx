import { createRoot } from 'react-dom/client'
import App from './App'
// @ts-ignore
import css from './index.css?inline'

const CONTAINER_ID = 'tiktok-bias-checker-root';

const injectExtension = () => {
    let container = document.getElementById(CONTAINER_ID);

    if (container) {
        // If it's attached elsewhere, move it to the very root
        if (container.parentElement !== document.documentElement) {
            document.documentElement.appendChild(container);
        }
        // If shadow DOM was somehow cleared, reset
        if (!container.shadowRoot || container.shadowRoot.childElementCount === 0) {
            container.remove();
            container = null;
        }
    }

    if (!container) {
        console.log('PoliTok: Injecting...');
        container = document.createElement('div');
        container.id = CONTAINER_ID;

        // Minimal footprint for the host container
        Object.assign(container.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '0',
            height: '0',
            zIndex: '2147483647',
            pointerEvents: 'none',
            display: 'block',
            all: 'initial' // Reset any inherited styles
        });
        // Force Z-index with important
        container.style.setProperty('z-index', '2147483647', 'important');

        document.documentElement.appendChild(container);

        const shadow = container.attachShadow({ mode: 'open' });
        const styleParams = document.createElement('style');
        styleParams.textContent = css + `
      .extension-root {
        position: fixed !important;
        bottom: 24px !important;
        left: 24px !important;
        pointer-events: auto !important;
        z-index: 2147483647 !important;
      }
    `;
        shadow.appendChild(styleParams);

        const rootDiv = document.createElement('div');
        rootDiv.className = 'extension-root';
        shadow.appendChild(rootDiv);

        createRoot(rootDiv).render(<App />);
    }
};

injectExtension();

// Ultra-aggressive check (500ms)
setInterval(injectExtension, 500);

// Watch for any removal of our container or changes to the root
const observer = new MutationObserver(() => {
    const container = document.getElementById(CONTAINER_ID);
    if (!container || container.parentElement !== document.documentElement || !container.shadowRoot || container.shadowRoot.childElementCount === 0) {
        injectExtension();
    }
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true // Watch deeper to catch stealthy removals
});
