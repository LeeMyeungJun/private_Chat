package com.moeum.chat;

import android.app.Instrumentation;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.Assume;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;
import android.graphics.Bitmap;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

@RunWith(AndroidJUnit4.class)
public class EntryTest {
    private Instrumentation getInstrumentation() { return InstrumentationRegistry.getInstrumentation(); }
    private void runTestOnUiThread(Runnable action) { getInstrumentation().runOnMainSync(action); }
    private boolean closedMode() { return "closed".equals(InstrumentationRegistry.getArguments().getString("mode")); }
    private void screenshot(MainActivity activity, String name) throws Exception {
        Thread.sleep(400);
        Bitmap screenshot = getInstrumentation().getUiAutomation().takeScreenshot();
        try (FileOutputStream output = new FileOutputStream(new File(activity.getFilesDir(), name))) {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, output);
        }
        screenshot.recycle();
    }
    private <T> void collect(View view, Class<T> type, ArrayList<T> result) {
        if (type.isInstance(view)) result.add(type.cast(view));
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) collect(group.getChildAt(i), type, result);
        }
    }
    @Test public void entryScreenHasOneButtonAndConnectsToCurrentMainPC() throws Exception {
        Assume.assumeFalse(closedMode());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
        MainActivity[] current = new MainActivity[1]; scenario.onActivity(value -> current[0] = value);
        MainActivity activity = current[0]; getInstrumentation().waitForIdleSync();
        ArrayList<Button> buttons = new ArrayList<>();
        runTestOnUiThread(() -> collect(activity.getWindow().getDecorView(), Button.class, buttons));
        assertEquals(1, buttons.size()); assertEquals("서버 입장", buttons.get(0).getText().toString());
        screenshot(activity, "android-entry.png");
        // Exercise real public discovery + instance matching, never a hardcoded hostname.
        ServerLocator.Server server = new ServerLocator().locate();
        assertTrue(new ServerLocator().alive(server));
        assertFalse("An address from a different server boot must be rejected", new ServerLocator().alive(
            new ServerLocator.Server(server.url, "00000000-0000-0000-0000-000000000000")));
        runTestOnUiThread(() -> buttons.get(0).performClick());
        ArrayList<WebView> views = new ArrayList<>();
        long deadline = System.currentTimeMillis() + 30000;
        while (System.currentTimeMillis() < deadline) {
            views.clear(); runTestOnUiThread(() -> collect(activity.getWindow().getDecorView(), WebView.class, views));
            if (!views.isEmpty()) break;
            Thread.sleep(200);
        }
        assertEquals("Server entry should open chat", 1, views.size());
        WebView view = views.get(0);
        CountDownLatch ready = new CountDownLatch(1);
        for (int i = 0; i < 60 && ready.getCount() > 0; i++) {
            runTestOnUiThread(() -> view.evaluateJavascript("Boolean(document.getElementById('login-form') && document.body.classList.contains('android-theme'))", value -> {
                if ("true".equals(value)) ready.countDown();
            }));
            Thread.sleep(200);
        }
        assertTrue("Real chat login and Figma theme should load", ready.await(1, TimeUnit.SECONDS));
        Thread.sleep(1500);
        screenshot(activity, "android-login.png");
        String password = InstrumentationRegistry.getArguments().getString("password");
        if (password != null) {
            String script = "document.getElementById('nickname').value='Android 확인';document.getElementById('password').value="
                + org.json.JSONObject.quote(password) + ";document.getElementById('login-form').requestSubmit();";
            runTestOnUiThread(() -> view.evaluateJavascript(script, null));
            CountDownLatch joined = new CountDownLatch(1);
            for (int i = 0; i < 60 && joined.getCount() > 0; i++) {
                runTestOnUiThread(() -> view.evaluateJavascript("!document.getElementById('workspace').hidden && document.getElementById('send-button').getBoundingClientRect().height>0", value -> {
                    if ("true".equals(value)) joined.countDown();
                }));
                Thread.sleep(200);
            }
            assertTrue("Existing chat should accept the same MainPC password", joined.await(1, TimeUnit.SECONDS));
            Thread.sleep(1500);
            CountDownLatch geometry = new CountDownLatch(1);
            runTestOnUiThread(() -> view.evaluateJavascript("['attach-button','send-button'].every(id=>document.getElementById(id).getBoundingClientRect().width>=43.8 && Math.abs(parseFloat(getComputedStyle(document.getElementById(id),'::after').width)-21.6)<0.2) && document.documentElement.scrollWidth<=innerWidth+1", value -> {
                if ("true".equals(value)) geometry.countDown();
            }));
            screenshot(activity, "android-chat.png");
            assertTrue("Figma icons should keep original dimensions without overflow", geometry.await(2, TimeUnit.SECONDS));
            runTestOnUiThread(() -> view.evaluateJavascript("document.getElementById('logout').click()", null));
        }
        }
    }
    @Test public void closedServerShowsNoticeAndKeepsEntryButton() throws Exception {
        Assume.assumeTrue(closedMode());
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            MainActivity[] current = new MainActivity[1]; scenario.onActivity(value -> current[0] = value);
            MainActivity activity = current[0];
            ArrayList<Button> buttons = new ArrayList<>();
            runTestOnUiThread(() -> collect(activity.getWindow().getDecorView(), Button.class, buttons));
            assertEquals(1, buttons.size());
            runTestOnUiThread(() -> buttons.get(0).performClick());
            long deadline = System.currentTimeMillis() + 30000; boolean closed = false;
            while (System.currentTimeMillis() < deadline) {
                ArrayList<TextView> labels = new ArrayList<>();
                runTestOnUiThread(() -> collect(activity.getWindow().getDecorView(), TextView.class, labels));
                closed = labels.stream().anyMatch(label -> label.getText().toString().contains("서버가 닫혀 있습니다"));
                if (closed) break; Thread.sleep(200);
            }
            assertTrue("Closed server should show its status", closed);
            ArrayList<WebView> views = new ArrayList<>();
            runTestOnUiThread(() -> collect(activity.getWindow().getDecorView(), WebView.class, views));
            assertTrue(views.isEmpty()); assertEquals("서버 입장", buttons.get(0).getText().toString());
            screenshot(activity, "android-closed.png");
        }
    }
}
