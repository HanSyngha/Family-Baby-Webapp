package me.synology.syngha.peanutfamily;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PeanutBackupPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();

        // 카카오 로그인 페이지는 UA의 "; wv" 표식으로 WebView를 감지하면 "카카오톡으로 로그인" 버튼을
        // 아예 내려주지 않고 계정 입력만 보여준다(크롬 UA와 대조 실측). 그래서 앱에서는 매번 아이디를 쳐야 했다.
        // 표식만 벗겨 일반 크롬 모바일과 같은 UA로 맞춘다(버전 문자열은 WebView 것을 그대로 유지).
        try {
            String ua = webView.getSettings().getUserAgentString();
            webView.getSettings().setUserAgentString(ua.replace("; wv", "").replace("Version/4.0 ", ""));
        } catch (Exception ignored) {
        }

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                if (userAgent != null) request.addRequestHeader("User-Agent", userAgent);

                String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(filename);
                request.setDescription("다운로드 중...");
                request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                request.allowScanningByMediaScanner();

                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager == null) throw new IllegalStateException("DownloadManager unavailable");
                manager.enqueue(request);
                Toast.makeText(this, "다운로드를 시작했어요", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "다운로드를 시작하지 못했어요", Toast.LENGTH_LONG).show();
            }
        });
    }

    // WebView 쿠키(fauth/frefresh)는 메모리에서 디스크로 주기적으로만 내려간다. 삼성 절전·스와이프 종료로
    // 프로세스가 강제 종료되면 최근 갱신분이 유실돼 다음 실행 때 로그인이 풀리므로 백그라운드 진입 시 즉시 flush.
    @Override
    public void onPause() {
        super.onPause();
        try {
            CookieManager.getInstance().flush();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}
