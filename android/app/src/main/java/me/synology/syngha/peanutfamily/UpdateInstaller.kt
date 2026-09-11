package me.synology.syngha.peanutfamily

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.net.URL

/** APK 다운로드 → 시스템 설치 화면 띄우기(OS 확인 1회). */
object UpdateInstaller {
    fun downloadAndInstall(context: Context, url: String, onError: (String) -> Unit, onSuccess: () -> Unit) {
        // 출처 검증: https + 서버(baseUrl)와 같은 호스트만. 브리지로 임의 APK 설치 시도 차단.
        val target = try { URL(url) } catch (e: Exception) { onError("잘못된 URL"); return }
        val base = try { URL(BackupPrefs.baseUrl(context)) } catch (e: Exception) { null }
        if (!target.protocol.equals("https", true) || (base != null && !target.host.equals(base.host, true))) {
            onError("허용되지 않은 업데이트 출처"); return
        }
        Thread {
            try {
                val dir = File(context.cacheDir, "updates")
                dir.mkdirs()
                val apk = File(dir, "update.apk")

                val client = OkHttpClient()
                client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                    if (!res.isSuccessful) { onError("다운로드 실패(HTTP ${res.code})"); return@Thread }
                    val body = res.body ?: run { onError("응답 본문 없음"); return@Thread }
                    body.byteStream().use { input ->
                        FileOutputStream(apk).use { out -> input.copyTo(out) }
                    }
                }

                // 설치 전 검증: 우리 패키지인지 + 다운그레이드 아님(엉뚱/구버전 APK 차단). 서명 연속성은 OS가 강제.
                val pm = context.packageManager
                val info = pm.getPackageArchiveInfo(apk.absolutePath, 0)
                if (info == null || info.packageName != context.packageName) { onError("APK 검증 실패"); return@Thread }
                val newCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode
                              else @Suppress("DEPRECATION") info.versionCode.toLong()
                val curCode = try {
                    val pi = pm.getPackageInfo(context.packageName, 0)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) pi.longVersionCode
                    else @Suppress("DEPRECATION") pi.versionCode.toLong()
                } catch (e: Exception) { 0L }
                if (newCode <= curCode) { onError("이미 최신이거나 더 낮은 버전"); return@Thread }

                val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                onSuccess()
            } catch (e: Exception) {
                onError(e.message ?: "업데이트 오류")
            }
        }.start()
    }
}
