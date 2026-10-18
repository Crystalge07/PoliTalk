import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

if (new URLSearchParams(location.search).has("welcome")) document.body.classList.add("welcome");

createRoot(document.getElementById("root")!).render(<App />);
