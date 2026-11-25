import { mount } from "svelte";
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700-italic.css";
import "./app.css";
import "./skins.css";
import App from "./App.svelte";

import { pcLoginRequest, showPcLogin } from "./pc-login";

const root = document.getElementById("app")!;
// PC 프로그램이 연 로그인 도우미 주소면 앱 대신 로그인 화면만 보여 준다.
const pcLogin = "__TAURI_INTERNALS__" in window ? null : pcLoginRequest(location.search);
if (pcLogin) showPcLogin(root, pcLogin);

export default pcLogin ? null : mount(App, { target: root });

// Web app (not the desktop build): offline cache and durable storage.
if (!("__TAURI_INTERNALS__" in window) && !("TwilightAndroid" in window) && import.meta.env.PROD) {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
}
