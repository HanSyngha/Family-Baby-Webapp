package me.synology.syngha.peanutfamily

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 백그라운드 백업 워커.
 * 신규 미디어(커서 이후) → 해시 → 중복 체크 → 개인공간 업로드. 진행률은 Foreground 알림.
 */
class BackupWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    private val ctx get() = applicationContext

    companion object {
        // 주기(periodic) 작업과 '지금 백업'(oneshot)은 유니크 이름이 달라 동시에 돌 수 있다.
        // 둘 다 같은 포그라운드 알림 id(42)로 setForeground를 호출하면, 한쪽이 끝날 때 공유 알림/
        // 포그라운드 상태가 내려가며 다른 쪽 워커가 OS에 의해 중단된다(=백업 멈춤, 토글해야 재개).
        // → 프로세스 전역 플래그로 한 번에 하나만 루프를 돌게 직렬화한다.
        private val running = java.util.concurrent.atomic.AtomicBoolean(false)
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (!BackupPrefs.enabled(ctx)) return@withContext Result.success()

        // 이미 다른 백업 워커가 실행 중이면 충돌 방지를 위해 즉시 종료(다음 주기에 이어서).
        if (!running.compareAndSet(false, true)) return@withContext Result.success()
        try {
            return@withContext runBackup()
        } finally {
            running.set(false)
        }
    }

    private suspend fun runBackup(): Result = withContext(Dispatchers.IO) {

        val refresh = BackupPrefs.refreshToken(ctx)
        if (refresh == null) {
            BackupPrefs.setState(ctx, now(), 0, false, "로그인 필요")
            return@withContext Result.success()
        }

        val api = BackupApi(BackupPrefs.baseUrl(ctx), ctx.contentResolver)
        var access = api.refreshAccessToken(refresh)
        if (access == null) {
            // 토큰 갱신 실패(네트워크/만료). retry()의 백오프 무한루프 대신 종료 — 다음 주기(15분)에 재시도.
            BackupPrefs.setState(ctx, now(), 0, false, "토큰 갱신 실패(재로그인 필요할 수 있음)")
            return@withContext Result.success()
        }

        // 커서 최초 초기화: 기존 전체 백업 옵션이 아니면 '지금'부터
        if (!BackupPrefs.cursorInitialized(ctx)) {
            BackupPrefs.setCursor(ctx, if (BackupPrefs.backupExisting(ctx)) 0L else now() / 1000)
        }

        val items = MediaScanner.newItems(
            ctx.contentResolver,
            BackupPrefs.folders(ctx),
            BackupPrefs.includeVideos(ctx),
            BackupPrefs.cursor(ctx)
        )
        if (items.isEmpty()) {
            BackupPrefs.setState(ctx, now(), 0, false, null)
            return@withContext Result.success()
        }

        try {
            setForeground(foregroundInfo(0, items.size))
        } catch (_: Exception) { /* 권한/상태에 따라 무시 */ }

        val hasLocation = ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.ACCESS_MEDIA_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        var done = 0
        var advance = true          // 첫 실패 전까지만 커서 전진(실패분은 다음 회차 재시도)
        var lastError: String? = null

        for (item in items) {
            // 사용자가 '중지' 눌렀거나 WorkManager가 취소하면 즉시 중단(다음 회차에 이어서).
            if (isStopped || BackupPrefs.stopRequested(ctx)) {
                BackupPrefs.setStopRequested(ctx, false)
                BackupPrefs.setState(ctx, now(), items.size - done, false, "백업 중지됨")
                return@withContext Result.success()
            }
            try {
                runCatching { setForeground(foregroundInfo(done, items.size)) }
                val token = access ?: break   // 토큰이 사라졌으면(재발급 실패) 중단, 다음 회차 재시도
                val readUri = MediaScanner.readUri(item.uri, hasLocation)
                val realSize = MediaScanner.sizeOf(ctx.contentResolver, readUri) ?: item.size
                val hash = QuickHash.compute(ctx.contentResolver, readUri, realSize)

                if (!api.isDuplicate(token, hash)) {
                    var code = api.upload(token, readUri, item.displayName, item.mimeType)
                    if (code == 401) {  // access 만료 → 1회 재발급 후 재시도
                        access = api.refreshAccessToken(refresh)
                        val renewed = access
                        code = if (renewed != null) api.upload(renewed, readUri, item.displayName, item.mimeType) else 401
                    }
                    if (code !in 200..299) {
                        lastError = "업로드 실패(HTTP $code): ${item.displayName}"
                        advance = false
                        continue
                    }
                }
                // 업로드 성공 또는 이미 존재(중복) → 처리 완료
                if (advance) BackupPrefs.setCursor(ctx, item.dateAdded)
                done++
                BackupPrefs.setState(ctx, now(), items.size - done, true, lastError)
            } catch (e: Exception) {
                lastError = "오류: ${e.message}"
                advance = false
            }
        }

        BackupPrefs.setState(ctx, now(), items.size - done, false, lastError)
        Result.success()
    }

    private fun now() = System.currentTimeMillis()

    private fun foregroundInfo(done: Int, total: Int): ForegroundInfo {
        val channelId = "peanut_backup"
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(channelId) == null) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, "백업", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notification = NotificationCompat.Builder(ctx, channelId)
            .setContentTitle("땅콩페밀리 백업 중")
            .setContentText("$done / $total")
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setOngoing(true)
            .setProgress(total, done, false)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(42, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(42, notification)
        }
    }
}
