package me.synology.syngha.peanutfamily

import android.content.ContentResolver
import android.net.Uri
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 서버 통신: 토큰 갱신 / 중복 체크 / 업로드. */
class BackupApi(private val baseUrl: String, private val resolver: ContentResolver) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        // writeTimeout은 '개별 write IO' 단위라(전체 업로드 시간 X) 60s면 느린-정상 업로드는 안 끊고
        // 죽은 커넥션의 영구 멈춤만 끊는다. 0(무제한)이면 한 번 멈춘 업로드가 워커를 영영 붙잡아
        // (단일실행 가드의) 모든 백업을 막을 수 있어 유한값 필수.
        .writeTimeout(60, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json".toMediaType()

    /** 마지막 refreshAccessToken 호출의 HTTP 상태(네트워크 오류면 0). 401이면 refresh token 자체가 폐기된 것. */
    var lastRefreshStatus = 0
        private set

    /** refresh token → access token. 실패 시 null. */
    fun refreshAccessToken(refreshToken: String): String? {
        val body = JSONObject().put("refreshToken", refreshToken).toString().toRequestBody(jsonType)
        val req = Request.Builder().url("$baseUrl/api/auth/token").post(body).build()
        lastRefreshStatus = 0
        client.newCall(req).execute().use { res ->
            lastRefreshStatus = res.code
            if (!res.isSuccessful) return null
            val s = res.body?.string() ?: return null
            val token = JSONObject(s).optString("accessToken")
            return if (token.isNullOrEmpty()) null else token
        }
    }

    /** 해시 중복 체크. 중복이면 true. */
    fun isDuplicate(accessToken: String, hash: String): Boolean {
        val body = JSONObject().put("hash", hash).toString().toRequestBody(jsonType)
        val req = Request.Builder().url("$baseUrl/api/media/check-duplicate")
            .header("Authorization", "Bearer $accessToken").post(body).build()
        client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) return false
            return JSONObject(res.body?.string() ?: "{}").optBoolean("duplicate", false)
        }
    }

    /**
     * 백업 진행률 보고.
     *
     * 폰에만 있는 숫자(로컬 총 개수)를 서버가 갖고 있어야 웹 홈에서도 진행률을 볼 수 있다.
     * 실패해도 백업 자체와는 무관하므로 조용히 무시한다.
     */
    fun reportProgress(
        accessToken: String,
        photoTotal: Int, photoDone: Int,
        videoTotal: Int, videoDone: Int,
        deviceName: String
    ): Boolean {
        return try {
            val json = JSONObject()
                .put("photoTotal", photoTotal).put("photoDone", photoDone)
                .put("videoTotal", videoTotal).put("videoDone", videoDone)
                .put("deviceName", deviceName)
                .toString().toRequestBody(jsonType)
            val req = Request.Builder().url("$baseUrl/api/backup/progress")
                .header("Authorization", "Bearer $accessToken").post(json).build()
            client.newCall(req).execute().use { it.isSuccessful }
        } catch (e: Exception) { false }
    }

    /** 개인공간(visibility=private)으로 업로드. HTTP 상태코드 반환(401=토큰만료). */
    fun upload(accessToken: String, uri: Uri, displayName: String, mimeType: String): Int {
        val fileBody = object : RequestBody() {
            override fun contentType() = mimeType.toMediaTypeOrNull()
            // -1 = 청크 전송. statSize와 실제 스트림 길이가 달라도(redacted URI 등)
            // Content-Length 불일치로 인한 "unexpected end of stream" 실패가 나지 않는다.
            override fun contentLength() = -1L
            override fun writeTo(sink: BufferedSink) {
                resolver.openInputStream(uri)?.use { input -> sink.writeAll(input.source()) }
            }
        }
        val multipart = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", displayName, fileBody)
            .build()
        val req = Request.Builder()
            .url("$baseUrl/api/media/upload?visibility=private")
            .header("Authorization", "Bearer $accessToken")
            .post(multipart).build()
        client.newCall(req).execute().use { res -> return res.code }
    }
}
