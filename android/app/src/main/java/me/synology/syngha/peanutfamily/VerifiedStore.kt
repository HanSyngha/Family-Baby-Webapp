package me.synology.syngha.peanutfamily

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * '이 사진은 서버에 원본이 있다'가 확인된 MediaStore 항목 기록.
 *
 * 백업 워커는 이미 항목마다 해시를 구해 서버에 중복 여부를 묻는다(api.isDuplicate).
 * 그 판정 결과를 버리지 말고 여기 남겨두면, 진행률을 내려고 전체 파일을 다시 해싱할 필요가 없다.
 * 업로드에 성공한 항목도 당연히 '서버에 있음'이므로 같이 기록한다.
 *
 * 왜 SharedPreferences가 아니라 SQLite인가: 항목이 수만 개가 되면 StringSet은 저장할 때마다
 * 전체를 직렬화해 다시 쓰기 때문에 백업 도중 계속 느려진다.
 *
 * ⚠️ 키가 (isVideo, id)인 이유: MediaStore의 Images._ID와 Video._ID는 서로 다른 네임스페이스라
 *    id만으로는 사진과 영상이 충돌한다.
 */
object VerifiedStore {

    private class Helper(ctx: Context) : SQLiteOpenHelper(ctx, "peanut_verified.db", null, 1) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """
                CREATE TABLE verified (
                  isVideo INTEGER NOT NULL,
                  mediaId INTEGER NOT NULL,
                  at      INTEGER NOT NULL,
                  PRIMARY KEY (isVideo, mediaId)
                )
                """.trimIndent()
            )
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            // 진행률 캐시일 뿐이라 버려도 백업 자체에는 영향이 없다(다음 백업이 다시 채운다).
            db.execSQL("DROP TABLE IF EXISTS verified")
            onCreate(db)
        }
    }

    @Volatile private var helper: Helper? = null

    private fun db(ctx: Context): SQLiteDatabase {
        val h = helper ?: synchronized(this) {
            helper ?: Helper(ctx.applicationContext).also { helper = it }
        }
        return h.writableDatabase
    }

    /** 서버에 원본이 있다고 확인된 항목으로 기록. */
    fun mark(ctx: Context, mediaId: Long, isVideo: Boolean) {
        try {
            val v = ContentValues().apply {
                put("isVideo", if (isVideo) 1 else 0)
                put("mediaId", mediaId)
                put("at", System.currentTimeMillis())
            }
            db(ctx).insertWithOnConflict("verified", null, v, SQLiteDatabase.CONFLICT_REPLACE)
        } catch (e: Exception) {
            // 진행률 표시용 부가 기능이라 실패해도 백업은 계속돼야 한다.
        }
    }

    /**
     * 확인된 id 집합. 진행률 계산은 '지금 폰에 있는 항목' 기준이라, 이 집합과 교집합을 낸다.
     * (폰에서 지운 사진이 계속 분자에 남아 100%를 넘기지 않도록)
     */
    fun idsOf(ctx: Context, isVideo: Boolean): HashSet<Long> {
        val out = HashSet<Long>()
        try {
            db(ctx).query(
                "verified", arrayOf("mediaId"), "isVideo = ?",
                arrayOf(if (isVideo) "1" else "0"), null, null, null
            ).use { c ->
                while (c.moveToNext()) out.add(c.getLong(0))
            }
        } catch (e: Exception) { /* 빈 집합 = 0% */ }
        return out
    }

    /** 폴더 설정이 바뀌는 등 기준이 달라졌을 때 초기화. */
    fun clear(ctx: Context) {
        try { db(ctx).delete("verified", null, null) } catch (e: Exception) {}
    }
}
