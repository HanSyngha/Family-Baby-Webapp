package me.synology.syngha.peanutfamily;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PeanutBackupPlugin.class);
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();

        // 뒤로 = 웹 화면 한 단계 뒤로(창 닫기·이전 탭). 더 갈 곳이 없을 때만 앱을 닫는다.
        // - targetSdk 36(Android 16)부터 예측형 뒤로가기가 기본이라 onBackPressed()가 아예 호출되지 않는다 —
        //   그래서 뒤로를 누르면 앱이 바로 꺼졌다. OnBackPressedDispatcher 콜백은 예측형 뒤로가기에서도 불린다.
        // - WebView.canGoBack()/copyBackForwardList()는 SPA가 pushState로 쌓은 기록을 모른다
        //   (Android 16 에뮬레이터 실측: 홈→생활 탭 이동 후 size=1, canGoBack=false). 그래서 페이지에 묻는다:
        //   라우터가 쌓은 기록(idx>0)이나 창(modal·immSheet)이 있으면 history.back(), 없으면 앱 종료.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) {
                    exitApp(this);
                    return;
                }
                OnBackPressedCallback self = this;
                wv.evaluateJavascript(
                    "(function(){ var s = history.state || {}; return !!(s.idx > 0 || s.modal || s.immSheet); })()",
                    canGoBack -> {
                        if ("true".equals(canGoBack)) wv.evaluateJavascript("history.back()", null);
                        else exitApp(self);
                    });
            }
        });

        // 키보드가 댓글 입력창을 덮던 문제(Android 15+). targetSdk 36이면 엣지투엣지가 강제돼 adjustResize가
        // 창을 줄이지 않고, 키보드 높이(IME 인셋)는 앱이 직접 반영해야 한다. Capacitor의 adjustMarginsForEdgeToEdge
        // 리스너는 시스템바만 여백으로 주고 IME는 버린다(CONSUMED) → WebView가 키보드 뒤까지 그대로 깔렸다.
        // 같은 리스너를 IME까지 반영하는 버전으로 덮어쓴다(Capacitor는 super.onCreate 안에서 먼저 등록함).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
                Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
                ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) v.getLayoutParams();
                mlp.leftMargin = bars.left;
                mlp.topMargin = bars.top;
                mlp.rightMargin = bars.right;
                mlp.bottomMargin = Math.max(bars.bottom, ime.bottom);   // IME 인셋은 내비게이션 바를 포함한 높이
                v.setLayoutParams(mlp);
                return WindowInsetsCompat.CONSUMED;
            });
        }

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

    // 뒤로 갈 곳이 없을 때: 콜백을 잠시 끄고 기본 동작(액티비티 종료)에 맡긴다
    private void exitApp(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        callback.setEnabled(true);
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
}
