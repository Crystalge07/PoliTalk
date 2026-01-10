import { createRoot } from 'react-dom/client'
import App from './App'
// @ts-ignore
import css from './index.css?inline'

const container = document.createElement('div')
container.id = 'tiktok-bias-checker-root'
document.body.appendChild(container)

const shadow = container.attachShadow({ mode: 'open' })

// Inject styles
const styleParams = document.createElement('style')
styleParams.textContent = css
shadow.appendChild(styleParams)

// Mount point inside shadow DOM
const rootDiv = document.createElement('div')
rootDiv.style.position = 'fixed'
rootDiv.style.bottom = '20px'
rootDiv.style.right = '20px'
rootDiv.style.zIndex = '999999'
shadow.appendChild(rootDiv)

rootDiv.className = 'extension-root'
createRoot(rootDiv).render(<App />)
