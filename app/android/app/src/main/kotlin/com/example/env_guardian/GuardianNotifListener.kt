package com.example.env_guardian

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Listens to active notifications to detect apps that are actively running in the
 * background (feature A). On Android 8+ any app doing real background work
 * (media playback, downloads, location…) must run a foreground service with a
 * persistent notification — so the set of packages with active notifications is a
 * reliable signal of "currently running" apps.
 *
 * ALSO tracks which packages currently show an ongoing CALL notification
 * (Notification.CATEGORY_CALL — used by WhatsApp/Telegram/Meet voice & video
 * calls). Combined with the audio mode, this lets the enforcer count a
 * screen-off VoIP call as app usage inside the restricted zone, which
 * UsageStats alone would miss.
 *
 * Requires the user to grant "Notification access" in system settings.
 */
class GuardianNotifListener : NotificationListenerService() {

    companion object {
        // Packages that currently have at least one active notification.
        val activePackages = mutableSetOf<String>()
        // Packages with an ongoing call-category notification right now.
        val callPackages = mutableSetOf<String>()
        fun snapshot(): List<String> = synchronized(activePackages) { activePackages.toList() }
        fun callSnapshot(): List<String> = synchronized(activePackages) { callPackages.toList() }
    }

    private fun isCallNotification(sbn: StatusBarNotification): Boolean {
        return try { sbn.notification?.category == Notification.CATEGORY_CALL } catch (e: Exception) { false }
    }

    private fun rebuild() {
        try {
            synchronized(activePackages) {
                activePackages.clear()
                callPackages.clear()
                activeNotifications?.forEach { sbn ->
                    sbn.packageName?.let {
                        activePackages.add(it)
                        if (isCallNotification(sbn)) callPackages.add(it)
                    }
                }
            }
        } catch (e: Exception) { /* listener not fully connected yet */ }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        rebuild()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn?.packageName?.let {
            synchronized(activePackages) {
                activePackages.add(it)
                if (isCallNotification(sbn)) callPackages.add(it)
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Recompute from the live set so we don't drop a package that still has
        // another active notification.
        rebuild()
    }
}
