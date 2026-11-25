package io.github.chlumael.twilightgames

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * The web UI (built into assets/web by `npm run build:android`) is served from
 * https://appassets.androidplatform.net so both the app and the overlay share
 * one origin, and therefore one localStorage.
 */
object WebSetup {
    const val START_URL = "https://appassets.androidplatform.net/assets/web/index.html"

    @SuppressLint("SetJavaScriptEnabled")
    fun configure(context: Context, webView: WebView, bridge: WebBridge) {
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // Stay on our own pages; nothing in the UI navigates elsewhere.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "appassets.androidplatform.net"
        }
        webView.addJavascriptInterface(bridge, "TwilightAndroid")
        webView.loadUrl(START_URL)
    }

    /** Ask the page to re-read storage (the other window may have saved). */
    fun reload(webView: WebView?) {
        webView?.evaluateJavascript("window.__twilightReload && window.__twilightReload()", null)
    }
}

/** Methods the page can call as `window.TwilightAndroid.*`. Calls arrive on a binder thread. */
class WebBridge(
    private val mode: String,
    private val onStartOverlay: () -> Unit = {},
    private val onCollapse: () -> Unit = {},
    private val onClose: () -> Unit = {},
    private val onSaveFile: (name: String, content: String) -> Unit = { _, _ -> },
    private val onSummary: (json: String) -> Unit = {},
    private val onCheckUpdate: () -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface fun mode(): String = mode
    @JavascriptInterface fun startOverlay() { main.post(onStartOverlay) }
    @JavascriptInterface fun collapse() { main.post(onCollapse) }
    @JavascriptInterface fun closeOverlay() { main.post(onClose) }
    @JavascriptInterface fun saveFile(name: String, content: String) { main.post { onSaveFile(name, content) } }
    @JavascriptInterface fun updateSummary(json: String) { main.post { onSummary(json) } }
    @JavascriptInterface fun appVersion(): String = BuildConfig.VERSION_NAME
    @JavascriptInterface fun checkUpdate() { main.post(onCheckUpdate) }
}
