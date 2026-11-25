package io.github.chlumael.twilightgames

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
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
import kotlin.math.abs

/**
 * Floating window over games: a small draggable bubble that expands into the
 * tracker panel (the web UI in "overlay" mode). Runs as a foreground service.
 */
class OverlayService : Service() {
    private lateinit var wm: WindowManager
    private lateinit var bubble: View
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
        startInForeground()
        if (!created) {
            created = true
            createViews()
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

        // --- bubble ---
        val size = dp(54)
        bubble = FrameLayout(this).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#E6161222"))
                setStroke(dp(2), Color.parseColor("#FFD3BC8E"))
            }
            addView(
                ImageView(this@OverlayService).apply { setImageResource(R.mipmap.ic_launcher) },
                FrameLayout.LayoutParams(dp(40), dp(40), Gravity.CENTER),
            )
        }
        bubbleParams = overlayParams(size, size, focusable = false).apply {
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
            WebBridge(mode = "overlay", onCollapse = ::collapse, onClose = ::stopSelf),
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
    }
}
