package com.example.env_guardian

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Listens to active notifications to detect apps that are actively running in the
 * background (feature A). On Android 8+ any app doing real background work
 * (media playback, downloads, location…) must run a foreground service with a
 * persistent notification — so the set of packages with active notifications is a
 * reliable signal of "currently running" apps.
 *
 * Requires the user to grant "Notification access" in system settings.
 */
class GuardianNotifListener : NotificationListenerService() {

    companion object {
        // Packages that currently have at least one active notification.
        val activePackages = mutableSetOf<String>()
        fun snapshot(): List<String> = synchronized(activePackages) { activePackages.toList() }
    }

    private fun rebuild() {
        try {
            synchronized(activePackages) {
                activePackages.clear()
                activeNotifications?.forEach { sbn -> sbn.packageName?.let { activePackages.add(it) } }
            }
        } catch (e: Exception) { /* listener not fully connected yet */ }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        rebuild()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn?.packageName?.let { synchronized(activePackages) { activePackages.add(it) } }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // Recompute from the live set so we don't drop a package that still has
        // another active notification.
        rebuild()
    }
}
