package io.github.chlumael.twilightgames

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.Toast

/** Full-screen app: the same web UI as the overlay, plus permissions and file import/export. */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: String? = null
    private var wantOverlay = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)
        WebSetup.configure(
            this, webView,
            WebBridge(
                mode = "app",
                onStartOverlay = ::startOverlay,
                onSaveFile = ::saveFile,
                onCheckUpdate = { checkUpdate(force = true) },
            ),
        )
        checkUpdate(force = intent.getBooleanExtra(Updater.EXTRA_SHOW_UPDATE, false))
        webView.webChromeClient = object : WebChromeClient() {
            // <input type=file> for backup import.
            override fun onShowFileChooser(
                view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                startActivityForResult(intent, REQ_OPEN)
                return true
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(Updater.EXTRA_SHOW_UPDATE, false)) checkUpdate(force = true)
    }

    private fun checkUpdate(force: Boolean) {
        Updater.check(this, force) { release ->
            when {
                release != null -> Updater.showDialog(this, release)
                force -> Toast.makeText(this, "최신 버전입니다 (${BuildConfig.VERSION_NAME})", Toast.LENGTH_SHORT).show()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        Updater.resumePendingInstall(this)
        WebSetup.reload(webView)
        // Came back from the overlay permission screen.
        if (wantOverlay && Settings.canDrawOverlays(this)) {
            wantOverlay = false
            launchOverlay()
        }
    }

    override fun onPause() {
        super.onPause()
        // Records may have changed here; let the overlay bar catch up.
        if (OverlayService.running) {
            startService(Intent(this, OverlayService::class.java).setAction(OverlayService.ACTION_REFRESH))
        }
    }

    private fun startOverlay() {
        if (Settings.canDrawOverlays(this)) {
            launchOverlay()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("다른 앱 위에 표시 권한")
            .setMessage("게임 화면 위에 트래커를 띄우려면 '다른 앱 위에 표시' 권한이 필요합니다. 다음 화면에서 황혼 게임즈를 허용해 주세요.")
            .setPositiveButton("설정 열기") { _, _ ->
                wantOverlay = true
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun launchOverlay() {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            // Optional: the overlay works without it, the status notification just stays hidden.
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }
        startForegroundService(Intent(this, OverlayService::class.java))
        Toast.makeText(this, "게임을 켜면 트래커 버블이 떠 있습니다", Toast.LENGTH_SHORT).show()
        moveTaskToBack(true)
    }

    private fun saveFile(name: String, content: String) {
        pendingSave = content
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("application/json")
            .putExtra(Intent.EXTRA_TITLE, name)
        startActivityForResult(intent, REQ_SAVE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        when (requestCode) {
            REQ_OPEN -> {
                fileCallback?.onReceiveValue(if (resultCode == RESULT_OK && uri != null) arrayOf(uri) else null)
                fileCallback = null
            }
            REQ_SAVE -> {
                val content = pendingSave
                pendingSave = null
                if (resultCode == RESULT_OK && uri != null && content != null) {
                    runCatching {
                        contentResolver.openOutputStream(uri)?.use { it.write(content.toByteArray()) }
                    }.onSuccess {
                        Toast.makeText(this, "백업을 저장했습니다", Toast.LENGTH_SHORT).show()
                    }.onFailure {
                        Toast.makeText(this, "저장 실패: ${it.message}", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val REQ_OPEN = 1
        private const val REQ_SAVE = 2
        private const val REQ_NOTIFY = 3
    }
}
