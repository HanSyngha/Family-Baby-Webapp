package me.synology.syngha.peanutfamily

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 재부팅 후 백업 주기 작업 재등록. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && BackupPrefs.enabled(context)) {
            BackupScheduler.schedule(context)
        }
    }
}
