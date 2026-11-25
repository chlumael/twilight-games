package io.github.chlumael.twilightgames

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs

/**
 * Floating window over games: a small draggable bubble that expands into the
 * tracker panel (the web UI in "overlay" mode). Runs as a foreground service.
 */
class OverlayService : Service() {
    private lateinit var wm: WindowManager
    private lateinit var bubble: LinearLayout
    private lateinit var arc: PityArc
    private lateinit var tGame: TextView
    private lateinit var tGroup: TextView
    private lateinit var tSure: TextView
    private lateinit var tPulls: TextView
    private lateinit var bubbleIcon: ImageView
    private lateinit var panel: LinearLayout
    private lateinit var webView: WebView
    private lateinit var bubbleParams: WindowManager.LayoutParams
    private lateinit var panelParams: WindowManager.LayoutParams
    private var expanded = false
    private var created = false

    private val prefs by lazy { getSharedPreferences("overlay", MODE_PRIVATE) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_REFRESH) {
            // The app saved something: re-read storage so the bar is current.
            if (created) WebSetup.reload(webView)
            return START_STICKY
        }
        running = true
        startInForeground()
        if (!created) {
            created = true
            createViews()
            // While playing, an update shows up as a notification instead of a dialog.
            Updater.check(this) { release -> if (release != null) Updater.notify(this, release) }
        }
        return START_STICKY
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "트래커 오버레이", NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, OverlayService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("황혼 게임즈")
            .setContentText("게임 위에 트래커를 띄우는 중")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "닫기", stop).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun overlayParams(w: Int, h: Int, focusable: Boolean) = WindowManager.LayoutParams(
        w, h,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        // Touches outside our window always reach the game.
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            (if (focusable) 0 else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE),
        PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }

    @SuppressLint("ClickableViewAccessibility")
    private fun createViews() {
        wm = getSystemService(WindowManager::class.java)

        // --- collapsed bar: [pity arc] 게임 그룹 확정 N뽑 (filled from the web UI) ---
        arc = PityArc()
        bubbleIcon = ImageView(this).apply { setImageResource(R.mipmap.ic_launcher) }
        tGame = barText(14f, bold = true)
        tGroup = barText(12f)
        tSure = barText(12f).apply { setTextColor(Color.parseColor("#FF4FCF7F")); text = "확정"; visibility = View.GONE }
        tPulls = barText(14f, bold = true)
        bubble = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(4), dp(12), dp(4))
            background = barBackground(Color.parseColor("#E6161222"), Color.parseColor("#FFD3BC8E"))
            addView(bubbleIcon, LinearLayout.LayoutParams(dp(34), dp(34)))
            addView(arc, LinearLayout.LayoutParams(dp(26), dp(26)).apply { marginEnd = dp(8) })
            addView(tGame, gap())
            addView(tGroup, gap())
            addView(tSure, gap())
            addView(tPulls)
        }
        arc.visibility = View.GONE
        listOf(tGame, tGroup, tPulls).forEach { it.visibility = View.GONE }
        bubbleParams = overlayParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, focusable = false,
        ).apply {
            x = prefs.getInt("bx", dp(8))
            y = prefs.getInt("by", dp(140))
        }
        bubble.setOnTouchListener(DragListener(bubbleParams, bubble, onTap = ::expand) { x, y ->
            prefs.edit().putInt("bx", x).putInt("by", y).apply()
        })

        // --- panel: native handle + web UI ---
        webView = WebView(this)
        WebSetup.configure(
            this, webView,
            WebBridge(mode = "overlay", onCollapse = ::collapse, onClose = ::stopSelf, onSummary = ::showSummary),
        )
        val handle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#F2161222"))
            setPadding(dp(10), 0, dp(4), 0)
            addView(
                TextView(this@OverlayService).apply {
                    text = "⠿ 황혼 게임즈"
                    setTextColor(Color.parseColor("#FFD3BC8E"))
                    textSize = 12f
                },
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { },
            )
            addView(handleButton("–") { collapse() })
            addView(handleButton("✕") { stopSelf() })
        }
        panel = object : LinearLayout(this) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                // Back collapses the panel instead of being swallowed.
                if (event.keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                    collapse()
                    return true
                }
                return super.dispatchKeyEvent(event)
            }
        }.apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(10).toFloat()
                setColor(Color.parseColor("#FF161222"))
                setStroke(dp(1), Color.parseColor("#80D3BC8E"))
            }
            clipToOutline = true
            addView(handle, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)))
            addView(webView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
        val metrics = resources.displayMetrics
        val w = minOf(dp(340), metrics.widthPixels - dp(16))
        val h = minOf(dp(560), metrics.heightPixels - dp(80))
        panelParams = overlayParams(w, h, focusable = true).apply {
            x = prefs.getInt("px", dp(8))
            y = prefs.getInt("py", dp(60))
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
        }
        handle.setOnTouchListener(DragListener(panelParams, panel, onTap = {}) { x, y ->
            prefs.edit().putInt("px", x).putInt("py", y).apply()
        })

        wm.addView(bubble, bubbleParams)
    }

    private fun barText(size: Float, bold: Boolean = false) = TextView(this).apply {
        textSize = size
        setTextColor(Color.WHITE)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        maxLines = 1
    }

    private fun gap() = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT,
    ).apply { marginEnd = dp(8) }

    private fun barBackground(fill: Int, stroke: Int) = GradientDrawable().apply {
        cornerRadius = dp(22).toFloat()
        setColor(fill)
        setStroke(dp(1), stroke)
    }

    private fun color(s: String?, fallback: Int): Int = runCatching { Color.parseColor(s) }.getOrDefault(fallback)

    /** JSON from the web UI: game, group, pity, hard, guaranteed, canPull, bg, text, accent, top. */
    private fun showSummary(json: String) {
        val o = runCatching { JSONObject(json) }.getOrNull() ?: return
        val text = color(o.optString("text"), Color.WHITE)
        val top = color(o.optString("top"), Color.parseColor("#FFFFD36B"))
        val bg = color(o.optString("bg"), Color.parseColor("#161222"))
        bubble.background = barBackground((bg and 0x00FFFFFF) or (0xEE shl 24), top)
        bubbleIcon.visibility = View.GONE
        arc.visibility = View.VISIBLE
        val hard = if (o.isNull("hard")) 0 else o.optInt("hard")
        arc.set(o.optInt("pity"), hard, top, (text and 0x00FFFFFF) or (0x33 shl 24))
        tGame.apply { this.text = o.optString("game"); setTextColor(text); visibility = View.VISIBLE }
        tGroup.apply {
            this.text = o.optString("group") + "  " + o.optInt("pity") + (if (hard > 0) "/$hard" else "")
            setTextColor((text and 0x00FFFFFF) or (0xB0 shl 24))
            visibility = View.VISIBLE
        }
        tSure.visibility = if (o.optBoolean("guaranteed")) View.VISIBLE else View.GONE
        tPulls.apply { this.text = "${o.optInt("canPull")}뽑"; setTextColor(text); visibility = View.VISIBLE }
        if (!expanded) runCatching { wm.updateViewLayout(bubble, bubbleParams) }
    }

    /** Small ring showing pity progress, like the desktop collapsed line. */
    private inner class PityArc : View(this@OverlayService) {
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp(4).toFloat() }
        private val value = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = dp(4).toFloat(); strokeCap = Paint.Cap.ROUND
        }
        private var ratio = 0f
        private val box = RectF()

        fun set(pity: Int, hard: Int, color: Int, trackColor: Int) {
            ratio = if (hard > 0) (pity.toFloat() / hard).coerceIn(0f, 1f) else 0f
            value.color = color
            track.color = trackColor
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val inset = track.strokeWidth / 2 + 1
            box.set(inset, inset, width - inset, height - inset)
            canvas.drawOval(box, track)
            if (ratio > 0f) canvas.drawArc(box, -90f, 360f * ratio, false, value)
        }
    }

    private fun handleButton(label: String, onClick: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 16f
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        layoutParams = LinearLayout.LayoutParams(dp(36), LinearLayout.LayoutParams.MATCH_PARENT)
        setOnClickListener { onClick() }
    }

    private fun expand() {
        if (expanded) return
        expanded = true
        wm.removeView(bubble)
        wm.addView(panel, panelParams)
        WebSetup.reload(webView)
    }

    private fun collapse() {
        if (!expanded) return
        expanded = false
        wm.removeView(panel)
        wm.addView(bubble, bubbleParams)
    }

    override fun onDestroy() {
        running = false
        if (created) {
            runCatching { wm.removeView(if (expanded) panel else bubble) }
            webView.destroy()
        }
        super.onDestroy()
    }

    /** Drag a window by its view; a short touch without movement counts as a tap. */
    private inner class DragListener(
        private val params: WindowManager.LayoutParams,
        private val window: View,
        private val onTap: () -> Unit,
        private val onMoved: (Int, Int) -> Unit,
    ) : View.OnTouchListener {
        private var startX = 0
        private var startY = 0
        private var touchX = 0f
        private var touchY = 0f
        private var moved = false

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouch(v: View, e: MotionEvent): Boolean {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x; startY = params.y
                    touchX = e.rawX; touchY = e.rawY
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - touchX
                    val dy = e.rawY - touchY
                    if (abs(dx) > dp(6) || abs(dy) > dp(6)) moved = true
                    if (moved) {
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        runCatching { wm.updateViewLayout(window, params) }
                    }
                }
                MotionEvent.ACTION_UP -> if (moved) onMoved(params.x, params.y) else onTap()
            }
            return true
        }
    }

    companion object {
        private const val CHANNEL = "overlay"
        private const val NOTIFICATION_ID = 1
        const val ACTION_STOP = "io.github.chlumael.twilightgames.STOP"
        const val ACTION_REFRESH = "io.github.chlumael.twilightgames.REFRESH"

        /** True while the overlay service is alive (lets the app ask it to refresh). */
        @Volatile var running = false
    }
}
