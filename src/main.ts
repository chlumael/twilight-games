import { mount } from "svelte";
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700-italic.css";
import "./app.css";
import "./skins.css";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app")! });

// Web app (not the desktop build): offline cache and durable storage.
if (!("__TAURI_INTERNALS__" in window) && import.meta.env.PROD) {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}
