package com.example.env_guardian

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Home-screen status widget: the LIVE companion to the debounced dynamic
 * launcher icon. Shows the current guard state (icon + text + last update)
 * and updates instantly on every enforcer pulse — no hysteresis, because a
 * widget refresh is invisible plumbing while a launcher-icon swap is not.
 */
class GuardianStatusWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        push(context, DynamicIconManager.desiredState(context))
    }

    companion object {

        fun push(context: Context, state: String) {
            try {
                val manager = AppWidgetManager.getInstance(context) ?: return
                val ids = manager.getAppWidgetIds(
                    ComponentName(context, GuardianStatusWidget::class.java)
                )
                if (ids.isEmpty()) return

                val views = RemoteViews(context.packageName, R.layout.guardian_widget)
                views.setImageViewResource(R.id.widget_icon, iconFor(state))
                views.setTextViewText(R.id.widget_status, titleFor(state))
                views.setTextViewText(R.id.widget_detail, detailFor(state))
                views.setTextViewText(
                    R.id.widget_time,
                    "Updated " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                )

                val launch = Intent(context, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                val pending = PendingIntent.getActivity(
                    context, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                views.setOnClickPendingIntent(R.id.widget_root, pending)

                manager.updateAppWidget(ids, views)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        private fun iconFor(state: String): Int = when (state) {
            DynamicIconManager.STATE_ONSITE -> R.mipmap.ic_launcher_onsite
            DynamicIconManager.STATE_SAFE -> R.mipmap.ic_launcher_safe
            DynamicIconManager.STATE_ATTENTION -> R.mipmap.ic_launcher_attention
            DynamicIconManager.STATE_ALERT -> R.mipmap.ic_launcher_alert
            DynamicIconManager.STATE_PAUSED -> R.mipmap.ic_launcher_paused
            else -> R.mipmap.ic_launcher
        }

        private fun titleFor(state: String): String = when (state) {
            DynamicIconManager.STATE_ONSITE -> "On-site — secure zone"
            DynamicIconManager.STATE_SAFE -> "Safe zone"
            DynamicIconManager.STATE_ATTENTION -> "Attention needed"
            DynamicIconManager.STATE_ALERT -> "Action required"
            DynamicIconManager.STATE_PAUSED -> "Monitoring paused"
            else -> "Env Guardian"
        }

        private fun detailFor(state: String): String = when (state) {
            DynamicIconManager.STATE_ONSITE -> "Compliant inside the restricted zone"
            DynamicIconManager.STATE_SAFE -> "Compliant — outside the restricted zone"
            DynamicIconManager.STATE_ATTENTION -> "Check permissions, GPS or sync"
            DynamicIconManager.STATE_ALERT -> "Enforcement issue — open the app"
            DynamicIconManager.STATE_PAUSED -> "Off-duty — this device is not tracked"
            else -> "Enroll this device to start protection"
        }
    }
}
