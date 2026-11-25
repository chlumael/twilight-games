package io.github.chlumael.twilightgames

import android.app.Activity
import android.app.AlertDialog
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/** A newer version published as a GitHub Release (tag `v<versionName>`, one .apk asset). */
data class Release(val version: String, val notes: String, val apkUrl: String)

/**
 * Self-update without the Play Store: check GitHub Releases, notify, download the
 * APK and open the system installer (Android always asks the user to confirm).
 * Works only while every release is signed with the same key (see android-release.yml).
 */
object Updater {
    private const val LATEST = "https://api.github.com/repos/chlumael/twilight-games/releases/latest"
    private const val CHANNEL = "updates"
    private const val NOTIFICATION_ID = 2
    private const val MIN_INTERVAL_MS = 6 * 60 * 60 * 1000L
    const val EXTRA_SHOW_UPDATE = "show_update"

    private val main = Handler(Looper.getMainLooper())

    /** Compare dotted versions numerically: "0.10.0" > "0.9.3". */
    fun isNewer(candidate: String, current: String): Boolean {
        val a = candidate.removePrefix("v").split('.', '-').map { it.toIntOrNull() ?: 0 }
        val b = current.removePrefix("v").split('.', '-').map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    /** Look up the latest release on a background thread; [onResult] runs on the main thread. */
    fun check(context: Context, force: Boolean = false, onResult: (Release?) -> Unit) {
        val prefs = context.getSharedPreferences("update", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (!force && now - prefs.getLong("lastCheck", 0) < MIN_INTERVAL_MS) {
            main.post { onResult(null) }
            return
        }
        thread(name = "update-check") {
            val release = runCatching { fetchLatest() }.getOrNull()
            prefs.edit().putLong("lastCheck", now).apply()
            val newer = release?.takeIf { isNewer(it.version, BuildConfig.VERSION_NAME) }
            main.post { onResult(newer) }
        }
    }

    private fun fetchLatest(): Release? {
        val conn = URL(LATEST).openConnection() as HttpURLConnection
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.setRequestProperty("User-Agent", "twilight-games-android")
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        try {
            if (conn.responseCode != 200) return null
            val json = JSONObject(conn.inputStream.bufferedReader().readText())
            val assets = json.optJSONArray("assets") ?: return null
            val apk = (0 until assets.length()).map { assets.getJSONObject(it) }
                .firstOrNull { it.optString("name").endsWith(".apk") } ?: return null
            return Release(
                version = json.optString("tag_name").removePrefix("v"),
                notes = json.optString("body").take(600),
                apkUrl = apk.optString("browser_download_url"),
            )
        } finally {
            conn.disconnect()
        }
    }

    /** Status-bar notice (used while the overlay runs over a game). Tapping opens the app's dialog. */
    fun notify(context: Context, release: Release) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "업데이트", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            context, 3,
            Intent(context, MainActivity::class.java).putExtra(EXTRA_SHOW_UPDATE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("황혼 게임즈 ${release.version} 업데이트")
            .setContentText("눌러서 업데이트하세요 (현재 ${BuildConfig.VERSION_NAME})")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { nm.notify(NOTIFICATION_ID, n) } // no-op if notifications are off
    }

    fun showDialog(activity: Activity, release: Release) {
        if (activity.isFinishing) return
        AlertDialog.Builder(activity)
            .setTitle("새 버전 ${release.version}")
            .setMessage("현재 ${BuildConfig.VERSION_NAME}\n\n${release.notes.ifBlank { "개선 사항이 있습니다." }}\n\n기록은 그대로 유지됩니다.")
            .setPositiveButton("업데이트") { _, _ -> download(activity, release) }
            .setNegativeButton("나중에", null)
            .show()
    }

    private fun download(activity: Activity, release: Release) {
        Toast.makeText(activity, "업데이트를 내려받는 중…", Toast.LENGTH_SHORT).show()
        thread(name = "update-download") {
            val dir = File(activity.getExternalFilesDir(null), "updates").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, "twilight-games-${release.version}.apk")
            val result = runCatching {
                val conn = URL(release.apkUrl).openConnection() as HttpURLConnection
                conn.setRequestProperty("User-Agent", "twilight-games-android")
                conn.instanceFollowRedirects = true
                conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
                conn.disconnect()
            }
            main.post {
                result.onSuccess { install(activity, file) }
                    .onFailure { Toast.makeText(activity, "다운로드 실패: ${it.message}", Toast.LENGTH_LONG).show() }
            }
        }
    }

    /** Pending APK while the user grants "install unknown apps" for this app. */
    private var pendingApk: File? = null

    fun install(activity: Activity, file: File) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            pendingApk = file
            Toast.makeText(activity, "다음 화면에서 '이 출처 허용'을 켜고 돌아오세요", Toast.LENGTH_LONG).show()
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")),
            )
            return
        }
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        activity.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    /** Call from onResume: continue an install that waited for the permission screen. */
    fun resumePendingInstall(activity: Activity) {
        val file = pendingApk ?: return
        if (activity.packageManager.canRequestPackageInstalls()) {
            pendingApk = null
            install(activity, file)
        }
    }
}
