package com.moeum.chat;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.URLUtil;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.ImageView;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int BACKGROUND = Color.rgb(32, 32, 32), PURPLE = Color.rgb(255, 81, 204);
    private static final int FILE_REQUEST = 10, CAMERA_REQUEST = 11, DOWNLOAD_REQUEST = 12;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final ServerLocator locator = new ServerLocator();
    private FrameLayout root;
    private LinearLayout landing;
    private TextView status;
    private Button enter;
    private WebView chat;
    private ServerLocator.Server server;
    private int generation;
    private boolean destroyed;
    private boolean connectionStarted;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private String downloadUrl, downloadCookie;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this); root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        ImageView backdrop = new ImageView(this); backdrop.setImageResource(R.drawable.stage);
        backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP); backdrop.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        root.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                root.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            } else {
                root.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return android.os.Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        buildLanding();
        configurePush();
        String savedUrl = ChatConnectionService.state(this).getString("url", "");
        String savedInstance = ChatConnectionService.state(this).getString("instance", "");
        if (ServerLocator.allowedAddress(savedUrl) && savedInstance.matches("[0-9a-f-]{36}")) {
            String savedCookie = ChatConnectionService.state(this).getString("cookie", "");
            if (!savedCookie.isEmpty()) CookieManager.getInstance().setCookie(savedUrl,
                savedCookie + "; Path=/; Secure; HttpOnly; SameSite=Strict");
            connectionStarted = true; openChat(new ServerLocator.Server(savedUrl, savedInstance));
        } else if ("ring".equals(getIntent().getStringExtra("action"))) connect();
    }

    private void configurePush() {
        if (FirebaseApp.initializeApp(this) == null) return;
        PushNotifications.channel(this);
        FirebaseMessaging.getInstance().unsubscribeFromTopic("moeum-room");
        ChatConnectionService.subscribe(this, ChatConnectionService.state(this).getString("instance", null), true);
        if (android.os.Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
            && !getPreferences(MODE_PRIVATE).getBoolean("notificationPermissionAsked", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("notificationPermissionAsked", true).apply();
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 30);
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if ("ring".equals(intent.getStringExtra("action"))) {
            if (chat == null) connect();
        }
    }

    private int dp(int size) { return Math.round(size * getResources().getDisplayMetrics().density); }
    @Override protected void onResume() {
        super.onResume();
        if (android.os.Build.VERSION.SDK_INT >= 30 && getWindow().getInsetsController() != null) {
            getWindow().getInsetsController().setSystemBarsAppearance(0,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else getWindow().getDecorView().setSystemUiVisibility(0);
        if (connectionStarted && !ChatConnectionService.state(this).contains("instance"))
            showLanding("서버 연결이 종료되었습니다. 다시 입장해 주세요.");
    }
    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size);
        view.setTextColor(color); view.setGravity(Gravity.CENTER); return view;
    }
    private void buildLanding() {
        landing = new LinearLayout(this); landing.setOrientation(LinearLayout.VERTICAL);
        landing.setGravity(Gravity.CENTER); landing.setPadding(dp(32), dp(24), dp(32), dp(24));
        landing.setBackgroundColor(Color.argb(150, 32, 32, 32));
        root.addView(landing, new FrameLayout.LayoutParams(-1, -1));
        TextView mark = text("모음", 44, PURPLE); mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        landing.addView(mark);
        TextView title = text("우리의 대화가 모이는 곳", 16, Color.rgb(199, 195, 216));
        LinearLayout.LayoutParams subtitle = new LinearLayout.LayoutParams(-1, -2); subtitle.topMargin = dp(12);
        landing.addView(title, subtitle);
        enter = new Button(this); enter.setId(View.generateViewId()); enter.setText("서버 입장");
        enter.setAllCaps(false); enter.setTextSize(18); enter.setTextColor(BACKGROUND);
        enter.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        GradientDrawable background = new GradientDrawable(); background.setColor(PURPLE); background.setCornerRadius(dp(18));
        enter.setBackground(background);
        LinearLayout.LayoutParams button = new LinearLayout.LayoutParams(-1, dp(60)); button.topMargin = dp(48);
        landing.addView(enter, button); enter.setOnClickListener(view -> connect());
        status = text("MainPC에서 서버를 연 뒤 입장해 주세요.", 14, Color.rgb(225, 213, 229));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        LinearLayout.LayoutParams note = new LinearLayout.LayoutParams(-1, -2); note.topMargin = dp(24);
        landing.addView(status, note);
    }

    private void connect() {
        final int request = ++generation;
        enter.setEnabled(false); enter.setText("서버 확인 중…"); status.setText("MainPC 서버에 연결하고 있습니다.");
        network.execute(() -> {
            try {
                ServerLocator.Server found = locator.locate();
                handler.post(() -> { if (!destroyed && request == generation) openChat(found); });
            } catch (Exception error) {
                handler.post(() -> { if (!destroyed && request == generation) showLanding("서버가 닫혀 있습니다.\nMainPC에서 서버를 열어 주세요."); });
            }
        });
    }

    private boolean trusted(String address) {
        if (server == null) return false;
        try { Uri uri = Uri.parse(address), origin = Uri.parse(server.url);
            return "https".equals(uri.getScheme()) && origin.getHost().equals(uri.getHost())
                && uri.getPort() == -1 && uri.getUserInfo() == null;
        } catch (Exception error) { return false; }
    }

    private void openChat(ServerLocator.Server found) {
        server = found; landing.setVisibility(View.GONE);
        chat = new WebView(this); chat.setBackgroundColor(BACKGROUND);
        root.addView(chat, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = chat.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(chat, false);
        chat.addJavascriptInterface(new Object() {
            @JavascriptInterface public void connected() {
                handler.post(() -> {
                    if (destroyed || server == null || chat == null) return;
                    String cookie = CookieManager.getInstance().getCookie(server.url);
                    if (cookie == null || !cookie.contains("chat_session=")) return;
                    ChatConnectionService.state(MainActivity.this).edit().putString("url", server.url)
                        .putString("instance", server.instanceId).putString("cookie", cookie).apply();
                    if (!connectionStarted) {
                        connectionStarted = true;
                        startForegroundService(new Intent(MainActivity.this, ChatConnectionService.class));
                    }
                });
            }
            @JavascriptInterface public void disconnect() {
                handler.post(() -> {
                    if (!connectionStarted) return;
                    ChatConnectionService.disconnect(MainActivity.this);
                    showLanding("서버 연결을 끊었습니다. 다시 입장할 수 있습니다.");
                });
            }
        }, "MoeumConnection");
        chat.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri address = request.getUrl();
                if (!trusted(address.toString())) return true;
                if ("/".equals(address.getPath()) && !"android".equals(address.getQueryParameter("client"))) {
                    view.loadUrl(address.buildUpon().appendQueryParameter("client", "android").build().toString());
                    return true;
                }
                return false;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !connectionStarted) showLanding("서버에 연결할 수 없습니다.\n서버와 인터넷 연결을 확인해 주세요.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500 && !connectionStarted) showLanding("서버가 닫혀 있습니다.\n서버를 열어 주세요.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showLanding("안전한 서버 연결을 확인할 수 없습니다.");
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush(); }
        });
        chat.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                finishFile(null); fileCallback = callback;
                if (params.isCaptureEnabled()) {
                    new AlertDialog.Builder(MainActivity.this).setItems(new String[]{"사진 촬영", "파일 선택"}, (dialog, which) -> {
                        if (which == 0) takePhoto(); else selectFile(params);
                    }).setOnCancelListener(dialog -> finishFile(null)).show();
                } else selectFile(params);
                return true;
            }
        });
        chat.setDownloadListener((url, agent, disposition, mime, size) -> {
            if (!trusted(url)) return;
            downloadUrl = url; downloadCookie = CookieManager.getInstance().getCookie(url);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType(mime == null ? "application/octet-stream" : mime)
                .addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE, URLUtil.guessFileName(url, disposition, mime));
            try { startActivityForResult(intent, DOWNLOAD_REQUEST); }
            catch (ActivityNotFoundException error) { toast("파일을 저장할 앱이 없습니다."); }
        });
        chat.loadUrl(server.url + "/?client=android"); scheduleHealth(generation);
    }

    private void scheduleHealth(int request) {
        handler.postDelayed(() -> {
            if (destroyed || chat == null || request != generation) return;
            if (connectionStarted && !ChatConnectionService.state(this).contains("instance"))
                showLanding("서버가 닫혔거나 연결을 끊었습니다.\n다시 열린 뒤 서버 입장을 눌러 주세요.");
            else scheduleHealth(request);
        }, 10000);
    }

    private void showLanding(String message) {
        ChatConnectionService.disconnect(this); connectionStarted = false;
        ++generation; server = null;
        if (chat != null) { chat.stopLoading(); root.removeView(chat); chat.destroy(); chat = null; }
        finishFile(null); landing.setVisibility(View.VISIBLE);
        enter.setEnabled(true); enter.setText("서버 입장"); status.setText(message);
    }
    @Override public void onBackPressed() {
        if (chat != null) {
            if (chat.canGoBack()) chat.goBack(); else moveTaskToBack(true);
        } else super.onBackPressed();
    }
    private void finishFile(Uri[] values) {
        if (fileCallback != null) { fileCallback.onReceiveValue(values); fileCallback = null; }
    }
    private void selectFile(WebChromeClient.FileChooserParams params) {
        try { startActivityForResult(params.createIntent(), FILE_REQUEST); }
        catch (ActivityNotFoundException error) { finishFile(null); toast("파일을 선택할 앱이 없습니다."); }
    }
    private void takePhoto() {
        try {
            File target = new File(getCacheDir(), "capture.jpg");
            if (target.exists()) target.delete();
            cameraUri = Uri.parse("content://" + getPackageName() + ".camera/capture.jpg");
            Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            capture.setClipData(android.content.ClipData.newRawUri("photo", cameraUri));
            startActivityForResult(capture, CAMERA_REQUEST);
        } catch (Exception error) { finishFile(null); toast("카메라를 열 수 없습니다."); }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == FILE_REQUEST) finishFile(WebChromeClient.FileChooserParams.parseResult(result, data));
        if (request == CAMERA_REQUEST) {
            finishFile(result == RESULT_OK ? new Uri[]{cameraUri} : null);
            if (cameraUri != null) revokeUriPermission(cameraUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            cameraUri = null;
        }
        if (request == DOWNLOAD_REQUEST && result == RESULT_OK && data != null && data.getData() != null) {
            saveDownload(data.getData(), downloadUrl, downloadCookie);
        }
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private void saveDownload(Uri destination, String address, String cookie) {
        if (address == null || !trusted(address)) { toast("서버 연결이 종료되었습니다. 다시 다운로드해 주세요."); return; }
        toast("파일을 저장하고 있습니다.");
        network.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(address).openConnection();
                connection.setConnectTimeout(10000); connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(false);
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                if (connection.getResponseCode() != 200) throw new IllegalStateException("Download failed");
                try (InputStream input = connection.getInputStream(); OutputStream output = getContentResolver().openOutputStream(destination, "wt")) {
                    if (output == null) throw new IllegalStateException("No output");
                    byte[] buffer = new byte[16384]; int length; long total = 0;
                    while ((length = input.read(buffer)) != -1) {
                        total += length; if (total > 50L * 1024 * 1024) throw new IllegalStateException("Too large");
                        output.write(buffer, 0, length);
                    }
                }
                handler.post(() -> { if (!destroyed) toast("다운로드가 완료되었습니다."); });
            } catch (Exception error) {
                try { android.provider.DocumentsContract.deleteDocument(getContentResolver(), destination); } catch (Exception ignored) {}
                handler.post(() -> { if (!destroyed) toast("다운로드하지 못했습니다. 서버 연결을 확인해 주세요."); });
            } finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void onDestroy() {
        destroyed = true; ++generation; handler.removeCallbacksAndMessages(null); network.shutdownNow();
        finishFile(null);
        if (chat != null) { root.removeView(chat); chat.destroy(); chat = null; }
        super.onDestroy();
    }
}
