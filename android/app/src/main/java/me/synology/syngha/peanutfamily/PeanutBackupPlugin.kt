package me.synology.syngha.peanutfamily

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

@CapacitorPlugin(
    name = "PeanutBackup",
    permissions = [
        // 백업의 필수 권한은 media뿐. location(GPS EXIF)은 선택이라 별도 alias로 분리해
        // 거부돼도 "권한 없음"으로 오판하지 않게 한다.
        Permission(alias = "media", strings = [
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VIDEO
        ]),
        // Android 12 이하(API<33)에서 실제 미디어 권한. READ_MEDIA_*는 33+ 전용이라 구형 기기 필수.
        Permission(alias = "legacy", strings = [Manifest.permission.READ_EXTERNAL_STORAGE]),
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_MEDIA_LOCATION]),
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])
    ]
)
class PeanutBackupPlugin : Plugin() {

    /**
     * WebView 밖으로 나가는 커스텀 스킴 처리.
     * 카카오 로그인 페이지의 "카카오톡으로 로그인"은 안드로이드에서 `intent://...#Intent;scheme=kakaotalk;package=com.kakao.talk;end`
     * 로 카카오톡을 깨운다. Capacitor 기본 구현(Bridge.launchIntent)은 이 URI를 그대로 ACTION_VIEW에 넣어
     * ActivityNotFoundException을 조용히 삼키므로, 앱 안에서는 버튼을 눌러도 아무 일도 안 일어나고
     * 결국 계정을 직접 입력하게 된다. intent://는 Intent.parseUri로 풀어서 실행하고, 앱이 없으면
     * browser_fallback_url → 스토어 순으로 대체한다. http/https 등은 null을 돌려 기본 동작에 맡긴다.
     */
    override fun shouldOverrideLoad(url: Uri?): Boolean? {
        val scheme = url?.scheme ?: return null
        if (scheme == "http" || scheme == "https" || scheme == "data" || scheme == "blob"
            || scheme == "about" || scheme == "javascript" || scheme == "file") return null
        val ctx = context
        try {
            if (scheme == "intent") {
                val intent = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME)
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                if (intent.resolveActivity(ctx.packageManager) != null) {
                    ctx.startActivity(intent)
                    return true
                }
                val fallback = intent.getStringExtra("browser_fallback_url")
                if (!fallback.isNullOrEmpty()) {
                    bridge.webView.loadUrl(fallback)
                    return true
                }
                val pkg = intent.`package`
                if (!pkg.isNullOrEmpty()) {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
                return true
            }
            // kakaotalk://, kakaolink://, market:// 등 일반 커스텀 스킴
            ctx.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            // 대상 앱 없음 — 페이지는 그대로 두고 조용히 무시(웹 로그인으로 진행 가능)
        } catch (e: Exception) {
            // URI 파싱 실패 등
        }
        return true
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        // 설정 현재값
        ret.put("enabled", BackupPrefs.enabled(context))
        ret.put("wifiOnly", BackupPrefs.wifiOnly(context))
        ret.put("chargingOnly", BackupPrefs.chargingOnly(context))
        ret.put("includeVideos", BackupPrefs.includeVideos(context))
        ret.put("batteryNotLow", BackupPrefs.batteryNotLow(context))
        ret.put("backupExisting", BackupPrefs.backupExisting(context))
        ret.put("intervalMinutes", BackupPrefs.intervalMinutes(context))
        val folders = JSArray()
        BackupPrefs.folders(context).forEach { folders.put(it) }
        ret.put("folders", folders)
        // 상태
        ret.put("uploading", BackupPrefs.uploading(context))
        ret.put("pending", BackupPrefs.pending(context))
        ret.put("lastRunAt", BackupPrefs.lastRunAt(context))
        BackupPrefs.lastError(context)?.let { ret.put("lastError", it) }
        ret.put("hasAuth", BackupPrefs.refreshToken(context) != null)
        ret.put("hasMediaPermission", getPermissionState(mediaAlias()) == PermissionState.GRANTED)
        call.resolve(ret)
    }

    /** WebView 로그인 직후 refresh token 저장(없으면 로그아웃 의미로 null 전달). */
    @PluginMethod
    fun setAuth(call: PluginCall) {
        BackupPrefs.setRefreshToken(context, call.getString("refreshToken"))
        call.resolve()
    }

    @PluginMethod
    fun setConfig(call: PluginCall) {
        val arr = call.getArray("folders")
        val folders = HashSet<String>()
        if (arr != null) for (i in 0 until arr.length()) arr.optString(i)?.let { if (it.isNotEmpty()) folders.add(it) }
        val wasExisting = BackupPrefs.backupExisting(context)
        val newExisting = call.getBoolean("backupExisting", false) ?: false
        BackupPrefs.setConfig(
            context,
            enabled = call.getBoolean("enabled", false) ?: false,
            wifiOnly = call.getBoolean("wifiOnly", true) ?: true,
            chargingOnly = call.getBoolean("chargingOnly", false) ?: false,
            includeVideos = call.getBoolean("includeVideos", true) ?: true,
            batteryNotLow = call.getBoolean("batteryNotLow", true) ?: true,
            backupExisting = newExisting,
            folders = folders,
            baseUrl = call.getString("baseUrl"),
            intervalMinutes = call.getInt("intervalMinutes", 15) ?: 15
        )
        // '기존 사진 백업'을 새로 켜면 → 커서를 0으로 리셋해 처음부터 다시 스캔(이미 올린 건 해시로 스킵)
        if (newExisting && !wasExisting) BackupPrefs.setCursor(context, 0L)
        BackupScheduler.schedule(context)
        call.resolve()
    }

    @PluginMethod
    fun runNow(call: PluginCall) {
        BackupPrefs.setStopRequested(context, false)   // 재개 의도 → 중지 플래그 해제
        BackupScheduler.runNow(context)
        call.resolve()
    }

    /** 진행 중 백업 중지: 워커가 다음 항목 전에 협조적으로 멈춘다(현재 업로드 1건은 마무리될 수 있음). */
    @PluginMethod
    fun stopBackup(call: PluginCall) {
        BackupPrefs.setStopRequested(context, true)
        call.resolve()
    }

    @PluginMethod
    fun listFolders(call: PluginCall) {
        val includeVideos = call.getBoolean("includeVideos", true) ?: true
        val arr = JSArray()
        for ((name, count) in MediaScanner.listFolders(context.contentResolver, includeVideos)) {
            val o = JSObject()
            o.put("name", name)
            o.put("count", count)
            arr.put(o)
        }
        val ret = JSObject()
        ret.put("folders", arr)
        call.resolve(ret)
    }

    // 미디어 권한 alias: Android 13+(API33)은 READ_MEDIA_*, 그 미만은 READ_EXTERNAL_STORAGE.
    private fun mediaAlias() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "media" else "legacy"

    // 권한 요청 체인: 미디어(필수) → location(선택, API29+) → notifications(선택, API33+).
    // 최종 granted는 미디어 기준으로만 판단한다.
    @PluginMethod
    fun ensurePermissions(call: PluginCall) {
        val alias = mediaAlias()
        if (getPermissionState(alias) == PermissionState.GRANTED) afterMedia(call)
        else requestPermissionForAlias(alias, call, "afterMedia")
    }

    @PermissionCallback
    private fun afterMedia(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterLocation")
        } else afterLocation(call)
    }

    @PermissionCallback
    private fun afterLocation(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotifications")
        } else resolveGranted(call)
    }

    @PermissionCallback
    private fun afterNotifications(call: PluginCall) {
        resolveGranted(call)
    }

    private fun resolveGranted(call: PluginCall) {
        val ret = JSObject()
        ret.put("granted", getPermissionState(mediaAlias()) == PermissionState.GRANTED)
        call.resolve(ret)
    }

    /** 서버 버전과 비교해 업데이트 여부 확인. */
    @PluginMethod
    fun checkUpdate(call: PluginCall) {
        Thread {
            val ret = JSObject()
            try {
                val baseUrl = BackupPrefs.baseUrl(context)
                val client = OkHttpClient()
                client.newCall(Request.Builder().url("$baseUrl/api/app/version").build()).execute().use { res ->
                    if (!res.isSuccessful) { ret.put("available", false); call.resolve(ret); return@Thread }
                    val json = JSONObject(res.body?.string() ?: "{}")
                    val serverCode = json.optLong("versionCode", 0)
                    var url = json.optString("url")
                    if (url.startsWith("/")) url = baseUrl + url
                    ret.put("available", serverCode > currentVersionCode())
                    ret.put("versionCode", serverCode)
                    ret.put("versionName", json.optString("versionName"))
                    ret.put("notes", json.optString("notes"))
                    ret.put("url", url)
                    call.resolve(ret)
                }
            } catch (e: Exception) {
                ret.put("available", false)
                call.resolve(ret)
            }
        }.start()
    }

    /** APK 다운로드 + 시스템 설치 화면 띄우기. */
    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrEmpty()) { call.reject("URL 없음"); return }
        // 결과(다운로드/설치 시작 또는 실패)를 JS로 돌려준다 → 배너에서 에러 표시 가능.
        UpdateInstaller.downloadAndInstall(
            context, url,
            onError = { msg -> call.reject(msg) },
            onSuccess = { call.resolve() }
        )
    }

    private fun currentVersionCode(): Long {
        return try {
            val pi = context.packageManager.getPackageInfo(context.packageName, 0)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode else @Suppress("DEPRECATION") pi.versionCode.toLong()
        } catch (e: Exception) { 0 }
    }

    /** 배터리 최적화 예외 요청(삼성 절전 대응). */
    @PluginMethod
    fun openBatterySettings(call: PluginCall) {
        val pkg = context.packageName
        try {
            val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            i.data = Uri.parse("package:$pkg")
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        } catch (e: Exception) {
            val i = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            i.data = Uri.parse("package:$pkg")
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(i)
        }
        call.resolve()
    }
}
