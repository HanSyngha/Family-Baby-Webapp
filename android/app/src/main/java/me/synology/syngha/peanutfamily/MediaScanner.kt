package me.synology.syngha.peanutfamily

import android.content.ContentResolver
import android.content.ContentUris
import android.net.Uri
import android.os.Build
import android.provider.MediaStore

data class MediaItem(
    val uri: Uri,
    val id: Long,
    val displayName: String,
    val mimeType: String,
    val size: Long,
    val dateAdded: Long,
    val bucket: String,
    val isVideo: Boolean
)

object MediaScanner {
    // 모든 API에서 동일한 컬럼명 리터럴(MediaColumns.BUCKET_DISPLAY_NAME 상수는 API 29+라서 리터럴 사용)
    private const val BUCKET = "bucket_display_name"

    /**
     * 선택 폴더에서 date_added >= cursor 인 신규 미디어를 date_added 오름차순으로.
     * `>=`(>가 아님)인 이유: 연사/버스트는 같은 초(date_added)를 공유할 수 있어, `>`면 마지막 처리 초와
     * 같은 초에 추가된 사진이 영구 누락된다. 경계의 항목은 재방문되지만 서버 해시 dedup이 중복 업로드를 막는다.
     */
    fun newItems(resolver: ContentResolver, folders: Set<String>, includeVideos: Boolean, cursor: Long): List<MediaItem> {
        val out = ArrayList<MediaItem>()
        out += query(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, folders, cursor, false)
        if (includeVideos) out += query(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, folders, cursor, true)
        out.sortBy { it.dateAdded }
        return out
    }

    private fun query(
        resolver: ContentResolver, collection: Uri, folders: Set<String>, cursor: Long, isVideo: Boolean
    ): List<MediaItem> {
        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED,
            BUCKET
        )
        val sel = StringBuilder("${MediaStore.MediaColumns.DATE_ADDED} >= ?")
        val args = ArrayList<String>()
        args.add(cursor.toString())
        if (folders.isNotEmpty()) {
            sel.append(" AND $BUCKET IN (${folders.joinToString(",") { "?" }})")
            args.addAll(folders)
        }
        val items = ArrayList<MediaItem>()
        resolver.query(
            collection, projection, sel.toString(), args.toTypedArray(),
            "${MediaStore.MediaColumns.DATE_ADDED} ASC"
        )?.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val mimeCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val sizeCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
            val dateCol = c.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
            val bucketCol = c.getColumnIndex(BUCKET)
            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                val size = c.getLong(sizeCol)
                if (size <= 0) continue
                val uri = ContentUris.withAppendedId(collection, id)
                items.add(
                    MediaItem(
                        uri = uri,
                        id = id,
                        displayName = c.getString(nameCol) ?: "$id",
                        mimeType = c.getString(mimeCol) ?: if (isVideo) "video/*" else "image/*",
                        size = size,
                        dateAdded = c.getLong(dateCol),
                        bucket = if (bucketCol >= 0) c.getString(bucketCol) ?: "" else "",
                        isVideo = isVideo
                    )
                )
            }
        }
        return items
    }

    /** 설정 화면용 폴더 목록(이름 + 항목 수), 많은 순. */
    fun listFolders(resolver: ContentResolver, includeVideos: Boolean): List<Pair<String, Int>> {
        val counts = HashMap<String, Int>()
        countInto(resolver, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, counts)
        if (includeVideos) countInto(resolver, MediaStore.Video.Media.EXTERNAL_CONTENT_URI, counts)
        return counts.entries.sortedByDescending { it.value }.map { it.key to it.value }
    }

    private fun countInto(resolver: ContentResolver, collection: Uri, counts: HashMap<String, Int>) {
        resolver.query(collection, arrayOf(BUCKET), null, null, null)?.use { c ->
            val col = c.getColumnIndex(BUCKET)
            if (col < 0) return
            while (c.moveToNext()) {
                val b = c.getString(col) ?: continue
                counts[b] = (counts[b] ?: 0) + 1
            }
        }
    }

    /**
     * 업로드/해시에 쓸 uri.
     * ACCESS_MEDIA_LOCATION 권한이 **있을 때만** setRequireOriginal로 원본(GPS EXIF 포함)을 요청한다.
     * 권한 없이 setRequireOriginal한 uri를 읽으면 예외가 나서 백업이 통째로 실패하므로,
     * 권한 없으면 일반 uri(읽기 가능, GPS는 제거됨)를 쓴다.
     */
    fun readUri(uri: Uri, hasLocationPermission: Boolean): Uri {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasLocationPermission) {
            try { MediaStore.setRequireOriginal(uri) } catch (e: Exception) { uri }
        } else uri
    }

    /**
     * 실제로 읽어 올릴 바이트 길이. redacted(GPS 제거) 버전은 MediaStore SIZE 컬럼과 길이가 다를 수 있어,
     * Content-Length/해시 일치를 위해 fd의 statSize로 실제 길이를 구한다. 실패 시 null.
     */
    fun sizeOf(resolver: ContentResolver, uri: Uri): Long? {
        return try {
            resolver.openFileDescriptor(uri, "r")?.use { val s = it.statSize; if (s >= 0) s else null }
        } catch (e: Exception) { null }
    }
}
