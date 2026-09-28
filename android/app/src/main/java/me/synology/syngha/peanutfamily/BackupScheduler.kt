package me.synology.syngha.peanutfamily

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

object BackupScheduler {
    private const val PERIODIC = "peanut_backup_periodic"
    private const val ONESHOT = "peanut_backup_now"

    /** 설정에 따라 주기 백업(15분) 등록 또는 취소. */
    fun schedule(ctx: Context) {
        val wm = WorkManager.getInstance(ctx)
        if (!BackupPrefs.enabled(ctx)) {
            wm.cancelUniqueWork(PERIODIC)
            return
        }
        // 사용자 설정 주기(분). 안드로이드 PeriodicWork 최소 15분 → 그 미만은 15로 클램프.
        val interval = BackupPrefs.intervalMinutes(ctx).coerceAtLeast(15).toLong()
        val req = PeriodicWorkRequestBuilder<BackupWorker>(interval, TimeUnit.MINUTES)
            .setConstraints(constraints(ctx))
            .build()
        wm.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, req)
    }

    /**
     * 지금 즉시 1회 백업.
     * KEEP: 이미 돌고 있으면 그대로 둔다. REPLACE였을 땐 버튼을 다시 누르면 돌던 작업이 취소되고,
     * 새 작업은 단일 실행 가드(running)에 걸려 바로 끝나 — 누를수록 진행이 멈췄다.
     */
    fun runNow(ctx: Context) {
        val req = OneTimeWorkRequestBuilder<BackupWorker>()
            .setConstraints(constraints(ctx))
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(ONESHOT, ExistingWorkPolicy.KEEP, req)
    }

    private fun constraints(ctx: Context): Constraints {
        val b = Constraints.Builder()
            .setRequiredNetworkType(if (BackupPrefs.wifiOnly(ctx)) NetworkType.UNMETERED else NetworkType.CONNECTED)
        if (BackupPrefs.chargingOnly(ctx)) b.setRequiresCharging(true)
        if (BackupPrefs.batteryNotLow(ctx)) b.setRequiresBatteryNotLow(true)
        return b.build()
    }
}
