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
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Point
import android.graphics.RectF
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
import android.view.WindowManager
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

        val size = screenSize()
        fitTo(size)
        val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = r
        display = mp.createVirtualDisplay(
            "twilight-screen", width, height, resources.displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, main,
        )
        running = true
        report("started", "")
        main.postDelayed(tick, FIRST_DELAY_MS)
    }

    /** 지금 화면의 실제 크기(회전 반영). */
    private fun screenSize(): Point {
        val p = Point()
        @Suppress("DEPRECATION")
        getSystemService(WindowManager::class.java).defaultDisplay.getRealSize(p)
        return p
    }

    /** 글자 인식에는 긴 쪽 1280픽셀이면 충분하다. 작게 찍어 배터리를 아낀다. */
    private fun fitTo(size: Point) {
        val scale = minOf(1f, 1280f / maxOf(size.x, size.y))
        width = (size.x * scale).toInt() / 2 * 2
        height = (size.y * scale).toInt() / 2 * 2
    }

    /** 게임이 가로로 돌면 찍는 화면도 같이 돌린다. 안 그러면 가로 화면이 세로 틀에 작게 들어간다. */
    private fun followRotation() {
        val size = screenSize()
        if ((size.x > size.y) == (width > height)) return
        fitTo(size)
        val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        val old = reader
        display?.resize(width, height, resources.displayMetrics.densityDpi)
        display?.surface = r.surface
        reader = r
        old?.close()
    }

    /** 마지막으로 게임 가챠 화면(또는 공개 화면)으로 보이는 글자를 본 시각 */
    private var lastGachaSeen = 0L

    /**
     * 읽는 간격: 가챠 화면이 보이면 그 뒤 잠시 동안은 빠르게(1초), 아니면 천천히(2.5초).
     * 연출을 빠르게 넘겨도 덜 놓치고, 다른 화면에서는 배터리를 아낀다(사용자 선택 2026-11-25).
     */
    private fun interval(): Long =
        if (System.currentTimeMillis() - lastGachaSeen < FAST_WINDOW_MS) FAST_INTERVAL_MS else INTERVAL_MS

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            readOnce()
            main.postDelayed(this, interval())
        }
    }

    private fun readOnce() {
        if (busy) return
        followRotation()
        val image = reader?.acquireLatestImage() ?: return
        if (OverlayService.isExpanded()) {
            // 펼친 창이 게임을 가리고 있으니 읽지 않는다(창 글자를 게임 글자로 착각하지 않게).
            image.close()
            return
        }
        val bitmap = try {
            val plane = image.planes[0]
            val rowPadding = plane.rowStride - plane.pixelStride * image.width
            val padded = Bitmap.createBitmap(
                image.width + rowPadding / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888,
            )
            padded.copyPixelsFromBuffer(plane.buffer)
            if (rowPadding == 0) padded
            else Bitmap.createBitmap(padded, 0, 0, image.width, image.height).copy(Bitmap.Config.ARGB_8888, true).also { padded.recycle() }
        } catch (e: Exception) {
            null
        } finally {
            image.close()
        }
        bitmap ?: return
        maskOverlay(bitmap)
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
                if (text.text.contains(GACHA_WORDS)) lastGachaSeen = System.currentTimeMillis()
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

    /** 우리 창(접힌 막대)이 있는 자리를 검게 지워서 그 글자를 읽지 않게 한다. */
    private fun maskOverlay(bitmap: Bitmap) {
        val rect = OverlayService.overlayRect() ?: return
        val size = screenSize()
        val sx = bitmap.width.toFloat() / size.x
        val sy = bitmap.height.toFloat() / size.y
        val paint = Paint().apply { color = Color.BLACK }
        Canvas(bitmap).drawRect(RectF(rect.left * sx, rect.top * sy, rect.right * sx, rect.bottom * sy), paint)
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
        private const val FAST_INTERVAL_MS = 1000L
        private const val FAST_WINDOW_MS = 20_000L
        /** 네 게임의 가챠 메인·뽑기 화면에 나오는 글자 (원신 공개 화면은 UID가 늘 보인다) */
        private val GACHA_WORDS = Regex("헤드헌팅|기원|추출|회\\s*진행|LUNACY|UID", RegexOption.IGNORE_CASE)
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
