package io.github.chlumael.twilightgames

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject

/**
 * 화면 읽기: 사용자가 허락하면 화면을 몇 초에 한 번 찍어 기기 안에서 글자를 인식하고,
 * 읽은 글자와 위치(화면 대비 비율)만 오버레이의 웹 화면으로 넘긴다.
 * 화면 그림은 저장하지도, 기기 밖으로 보내지도 않는다.
 */
class ScreenReadService : Service() {
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private val main = Handler(Looper.getMainLooper())
    private val recognizer by lazy { TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build()) }
    private var busy = false
    private var width = 0
    private var height = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP || intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        startInForeground()
        val code = intent.getIntExtra(EXTRA_CODE, Activity.RESULT_CANCELED)
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_DATA)
        }
        if (code != Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        runCatching { startCapture(code, data) }.onFailure {
            report("error", it.message ?: "화면 읽기를 시작하지 못했습니다")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "화면 읽기", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(
            this, 2, Intent(this, ScreenReadService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("황혼 게임즈가 화면을 읽는 중")
            .setContentText("눌러서 끄기")
            .setContentIntent(stop)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startCapture(code: Int, data: Intent) {
        val mgr = getSystemService(MediaProjectionManager::class.java)
        val mp = mgr.getMediaProjection(code, data) ?: error("화면 녹화 권한을 받지 못했습니다")
        projection = mp
        // 안드로이드 14부터는 가상 화면을 만들기 전에 콜백을 등록해야 한다.
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { stopSelf() }
        }, main)

        val metrics = resources.displayMetrics
        // 글자 인식에는 긴 쪽 1280픽셀이면 충분하다. 작게 찍어 배터리를 아낀다.
        val scale = minOf(1f, 1280f / maxOf(metrics.widthPixels, metrics.heightPixels))
        width = (metrics.widthPixels * scale).toInt() / 2 * 2
        height = (metrics.heightPixels * scale).toInt() / 2 * 2
        val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = r
        display = mp.createVirtualDisplay(
            "twilight-screen", width, height, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, main,
        )
        running = true
        report("started", "")
        main.postDelayed(tick, FIRST_DELAY_MS)
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            readOnce()
            main.postDelayed(this, INTERVAL_MS)
        }
    }

    private fun readOnce() {
        if (busy) return
        val image = reader?.acquireLatestImage() ?: return
        val bitmap = try {
            val plane = image.planes[0]
            val rowPadding = plane.rowStride - plane.pixelStride * image.width
            val padded = Bitmap.createBitmap(
                image.width + rowPadding / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888,
            )
            padded.copyPixelsFromBuffer(plane.buffer)
            if (rowPadding == 0) padded else Bitmap.createBitmap(padded, 0, 0, image.width, image.height).also { padded.recycle() }
        } catch (e: Exception) {
            null
        } finally {
            image.close()
        }
        bitmap ?: return
        busy = true
        val w = bitmap.width.toFloat()
        val h = bitmap.height.toFloat()
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener { text ->
                val lines = JSONArray()
                for (block in text.textBlocks) for (line in block.lines) {
                    val box = line.boundingBox ?: continue
                    lines.put(
                        JSONObject()
                            .put("t", line.text)
                            .put("x", (box.left / w).toDouble()).put("y", (box.top / h).toDouble())
                            .put("w", (box.width() / w).toDouble()).put("h", (box.height() / h).toDouble()),
                    )
                }
                val payload = JSONObject()
                    .put("time", System.currentTimeMillis())
                    .put("landscape", w > h)
                    .put("lines", lines)
                OverlayService.screenText(payload.toString())
            }
            .addOnCompleteListener {
                bitmap.recycle()
                busy = false
            }
    }

    private fun report(state: String, message: String) {
        OverlayService.screenState(JSONObject().put("state", state).put("message", message).toString())
    }

    override fun onDestroy() {
        val wasRunning = running
        running = false
        main.removeCallbacks(tick)
        runCatching { display?.release() }
        runCatching { reader?.close() }
        runCatching { projection?.stop() }
        runCatching { recognizer.close() }
        if (wasRunning) report("stopped", "")
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "screen-read"
        private const val NOTIFICATION_ID = 2
        private const val INTERVAL_MS = 2500L
        private const val FIRST_DELAY_MS = 800L
        const val ACTION_STOP = "io.github.chlumael.twilightgames.SCREEN_STOP"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"

        @Volatile var running = false

        fun stop(context: Context) {
            context.startService(Intent(context, ScreenReadService::class.java).setAction(ACTION_STOP))
        }
    }
}

/**
 * 화면 녹화 동의 창을 띄우기 위한 투명 화면. 동의 창은 Activity에서만 띄울 수 있어서
 * 오버레이(서비스)가 이 화면을 잠깐 열고, 결과를 ScreenReadService로 넘긴 뒤 바로 닫는다.
 */
class CaptureConsentActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val mgr = getSystemService(MediaProjectionManager::class.java)
        @Suppress("DEPRECATION")
        startActivityForResult(mgr.createScreenCaptureIntent(), 1)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode == RESULT_OK && data != null) {
            startForegroundService(
                Intent(this, ScreenReadService::class.java)
                    .putExtra(ScreenReadService.EXTRA_CODE, resultCode)
                    .putExtra(ScreenReadService.EXTRA_DATA, data),
            )
        } else {
            OverlayService.screenState(JSONObject().put("state", "denied").put("message", "").toString())
        }
        finish()
    }
}
