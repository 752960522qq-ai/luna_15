package com.luna.heelmotion;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String PAGE = "https://" + HOST + "/assets/index.html";
    private WebView webView;
    private FrameLayout container;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(16, 27, 39));
        setContentView(container);
        if (Build.VERSION.SDK_INT >= 28) {
            container.setOnApplyWindowInsetsListener((view, insets) -> {
                android.view.DisplayCutout cutout = insets.getDisplayCutout();
                view.setPadding(cutout == null ? 0 : cutout.getSafeInsetLeft(),
                    cutout == null ? 0 : cutout.getSafeInsetTop(),
                    cutout == null ? 0 : cutout.getSafeInsetRight(),
                    cutout == null ? 0 : cutout.getSafeInsetBottom());
                return insets;
            });
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER;
            getWindow().setAttributes(attributes);
        }
        immersive();
        createWebView();
    }

    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(16, 27, 39));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setVerticalScrollBarEnabled(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.addJavascriptInterface(new LocalSaveBridge(
            getSharedPreferences("luna_life_v1", MODE_PRIVATE)), "LunaLocalStore");
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                if (local(request.getUrl())) {
                    WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                    if (response != null) return response;
                }
                // Local assets are the entire application; never fall back to the network.
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(
                    WebView view, WebResourceRequest request) {
                return !local(request.getUrl());
            }
            @Override public boolean onRenderProcessGone(
                    WebView view, android.webkit.RenderProcessGoneDetail detail) {
                container.removeView(view);
                view.destroy();
                webView = null;
                TextView retry = new TextView(MainActivity.this);
                retry.setText("图形环境已暂停，点击重新加载");
                retry.setTextColor(Color.WHITE);
                retry.setTextSize(18);
                retry.setGravity(android.view.Gravity.CENTER);
                retry.setOnClickListener(v -> { container.removeView(retry); createWebView(); });
                container.addView(retry, new FrameLayout.LayoutParams(-1, -1));
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG) {
                    Log.d("HeelMotionWeb", message.messageLevel() + ": " + message.message()
                        + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                }
                return true;
            }
        });
        container.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.requestFocus();
        boolean diagnostics = BuildConfig.DEBUG && getIntent().getBooleanExtra("diagnostics", false);
        webView.loadUrl(PAGE + (diagnostics ? "?diagnostics=1" : ""));
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
            && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    /** Two private save slots, synchronously committed before JS gets success. */
    public static final class LocalSaveBridge {
        private final SharedPreferences preferences;
        LocalSaveBridge(SharedPreferences preferences) { this.preferences = preferences; }
        private boolean allowed(String key) {
            return "luna15.life.v1.a".equals(key) || "luna15.life.v1.b".equals(key);
        }
        @JavascriptInterface public String getItem(String key) {
            return allowed(key) ? preferences.getString(key, null) : null;
        }
        @JavascriptInterface public boolean setItem(String key, String value) {
            return allowed(key) && value != null && value.length() <= 65536
                && preferences.edit().putString(key, value).commit();
        }
        @JavascriptInterface public boolean removeItem(String key) {
            return allowed(key) && preferences.edit().remove(key).commit();
        }
    }

    @SuppressWarnings("deprecation") private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive();
    }
    @Override protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('blur'));", null);
            webView.onPause();
        }
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }
    @Override protected void onDestroy() {
        if (webView != null) {
            container.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
    WebView getTestWebView() { return webView; }
}
