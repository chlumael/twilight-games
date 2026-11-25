import { mount } from "svelte";
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700-italic.css";
import "./app.css";
import "./skins.css";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app")! });
