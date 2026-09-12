package me.synology.syngha.peanutfamily

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * 백업 설정/상태 저장소.
 * - 일반 설정/상태: 평문 SharedPreferences
 * - refresh token: EncryptedSharedPreferences(Android Keystore 기반)
 */
object BackupPrefs {
    private const val CONFIG = "peanut_backup"
    private const val SECURE = "peanut_secure"
    const val DEFAULT_BASE_URL = "https://syngha.synology.me:2290"

    private fun cfg(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(CONFIG, Context.MODE_PRIVATE)

    // Keystore 리셋/기기 이전 등으로 복호화가 실패하면 예외가 나서 앱이 죽는다.
    // → 손상 파일 삭제 후 1회 재시도, 그래도 실패면 null(로그아웃 취급).
    private fun secure(ctx: Context): SharedPreferences? {
        return try {
            buildSecure(ctx)
        } catch (e: Exception) {
            try {
                if (Build.VERSION.SDK_INT >= 24) ctx.deleteSharedPreferences(SECURE)
                buildSecure(ctx)
            } catch (e2: Throwable) { null }
        }
    }

    private fun buildSecure(ctx: Context): SharedPreferences {
        val key = MasterKey.Builder(ctx)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            ctx, SECURE, key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    // ---- 설정 ----
    fun enabled(ctx: Context) = cfg(ctx).getBoolean("enabled", false)
    fun wifiOnly(ctx: Context) = cfg(ctx).getBoolean("wifiOnly", true)
    fun chargingOnly(ctx: Context) = cfg(ctx).getBoolean("chargingOnly", false)
    fun includeVideos(ctx: Context) = cfg(ctx).getBoolean("includeVideos", true)
    fun batteryNotLow(ctx: Context) = cfg(ctx).getBoolean("batteryNotLow", true)
    fun backupExisting(ctx: Context) = cfg(ctx).getBoolean("backupExisting", false)
    fun folders(ctx: Context): Set<String> = cfg(ctx).getStringSet("folders", emptySet()) ?: emptySet()
    fun baseUrl(ctx: Context) = cfg(ctx).getString("baseUrl", DEFAULT_BASE_URL) ?: DEFAULT_BASE_URL
    // 백업 주기(분). 안드로이드 PeriodicWork 최소가 15분이라 그 미만은 의미 없음 → 스케줄러에서 15로 클램프.
    fun intervalMinutes(ctx: Context) = cfg(ctx).getInt("intervalMinutes", 15)

    fun setConfig(
        ctx: Context, enabled: Boolean, wifiOnly: Boolean, chargingOnly: Boolean,
        includeVideos: Boolean, batteryNotLow: Boolean, backupExisting: Boolean,
        folders: Set<String>, baseUrl: String?, intervalMinutes: Int
    ) {
        val e = cfg(ctx).edit()
        e.putBoolean("enabled", enabled)
        e.putBoolean("wifiOnly", wifiOnly)
        e.putBoolean("chargingOnly", chargingOnly)
        e.putBoolean("includeVideos", includeVideos)
        e.putBoolean("batteryNotLow", batteryNotLow)
        e.putBoolean("backupExisting", backupExisting)
        e.putStringSet("folders", folders)
        e.putInt("intervalMinutes", intervalMinutes)
        if (baseUrl != null) e.putString("baseUrl", baseUrl)
        e.apply()
    }

    // 진행 중 백업 중지 요청 플래그. 워커가 매 항목마다 확인해 협조적으로 멈춘다.
    fun stopRequested(ctx: Context) = cfg(ctx).getBoolean("stopRequested", false)
    fun setStopRequested(ctx: Context, v: Boolean) = cfg(ctx).edit().putBoolean("stopRequested", v).apply()

    // ---- 커서(마지막 처리한 date_added, 초 단위) ----
    fun cursorInitialized(ctx: Context) = cfg(ctx).contains("cursor")
    fun cursor(ctx: Context) = cfg(ctx).getLong("cursor", 0L)
    fun setCursor(ctx: Context, v: Long) = cfg(ctx).edit().putLong("cursor", v).apply()

    // ---- 최초 전체 대조 스윕 ----
    // 백업 커서는 '어디까지 올렸나'를 가리킬 뿐이라, 앱 설치 전부터 있던 사진이 서버에 있는지는
    // 모른다. 그래서 별도 커서로 전체를 한 번 훑으며 해시 대조 결과를 VerifiedStore에 채운다.
    // 시간이 오래 걸리므로 한 번에 다 하지 않고 회차마다 시간 예산만큼만 진행한다.
    fun sweepCursor(ctx: Context) = cfg(ctx).getLong("sweepCursor", 0L)
    fun setSweepCursor(ctx: Context, v: Long) = cfg(ctx).edit().putLong("sweepCursor", v).apply()
    fun sweepDone(ctx: Context) = cfg(ctx).getBoolean("sweepDone", false)
    fun setSweepDone(ctx: Context, v: Boolean) = cfg(ctx).edit().putBoolean("sweepDone", v).apply()
    /** 폴더 설정이 바뀌면 대조 기준이 달라지므로 처음부터 다시. */
    fun resetSweep(ctx: Context) {
        cfg(ctx).edit().putLong("sweepCursor", 0L).putBoolean("sweepDone", false).apply()
    }

    // ---- 상태(UI 표시용) ----
    fun setState(ctx: Context, lastRunAt: Long, pending: Int, uploading: Boolean, lastError: String?) {
        val e = cfg(ctx).edit()
        e.putLong("lastRunAt", lastRunAt)
        e.putInt("pending", pending)
        e.putBoolean("uploading", uploading)
        if (lastError == null) e.remove("lastError") else e.putString("lastError", lastError)
        e.apply()
    }
    fun lastRunAt(ctx: Context) = cfg(ctx).getLong("lastRunAt", 0L)
    fun pending(ctx: Context) = cfg(ctx).getInt("pending", 0)
    fun uploading(ctx: Context) = cfg(ctx).getBoolean("uploading", false)
    fun lastError(ctx: Context): String? = cfg(ctx).getString("lastError", null)

    // ---- refresh token(암호화) ----
    fun refreshToken(ctx: Context): String? = try { secure(ctx)?.getString("refreshToken", null) } catch (e: Exception) { null }
    fun setRefreshToken(ctx: Context, token: String?) {
        val e = secure(ctx)?.edit() ?: return
        if (token == null) e.remove("refreshToken") else e.putString("refreshToken", token)
        e.apply()
    }
}
