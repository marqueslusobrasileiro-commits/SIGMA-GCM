package com.sigmagcm.app;

import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * O app Capacitor usa {@code http://localhost} no WebView; chamadas à API em {@code https://...}
 * podem ser bloqueadas como “mixed content” em alguns aparelhos → {@code Failed to fetch}.
 */
public class MainActivity extends BridgeActivity {

  @Override
  public void onStart() {
    super.onStart();
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    }
  }
}
