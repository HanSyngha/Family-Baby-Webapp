package me.synology.syngha.peanutfamily

import android.content.ContentResolver
import android.net.Uri
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.security.MessageDigest

/**
 * 서버(server/routes/media.ts computeQuickHash) / 웹(api.ts hashFile)과 **바이트 단위 동일**한 빠른 해시.
 * - size <= 4MB: 전체 바이트의 SHA-256
 * - size > 4MB: SHA-256( 앞 4MB ‖ 뒤 4MB ‖ 파일크기(IEEE754 double, big-endian 8B) )
 */
object QuickHash {
    private const val CHUNK = 4 * 1024 * 1024

    fun compute(resolver: ContentResolver, uri: Uri, size: Long): String {
        val md = MessageDigest.getInstance("SHA-256")
        if (size <= CHUNK) {
            resolver.openInputStream(uri)!!.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    md.update(buf, 0, n)
                }
            }
        } else {
            resolver.openFileDescriptor(uri, "r")!!.use { pfd ->
                FileInputStream(pfd.fileDescriptor).channel.use { ch ->
                    val head = ByteBuffer.allocate(CHUNK)
                    val headN = readFully(ch, head, 0L)
                    md.update(head.array(), 0, headN)

                    val tail = ByteBuffer.allocate(CHUNK)
                    val tailN = readFully(ch, tail, size - CHUNK)
                    md.update(tail.array(), 0, tailN)

                    val sizeBuf = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN)
                    sizeBuf.putDouble(size.toDouble())
                    md.update(sizeBuf.array())
                }
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun readFully(ch: FileChannel, buf: ByteBuffer, position: Long): Int {
        ch.position(position)
        while (buf.hasRemaining()) {
            val n = ch.read(buf)
            if (n < 0) break
        }
        return buf.position()   // 실제 읽은 바이트(정상 케이스는 CHUNK와 동일)
    }
}
