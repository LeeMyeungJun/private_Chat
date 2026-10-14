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
            runTestOnUiThread(() -> view.evaluateJavascript("Boolean(document.getElementById('login-form') && !document.getElementById('password') && document.body.classList.contains('android-theme'))", value -> {
                if ("true".equals(value)) ready.countDown();
            }));
            Thread.sleep(200);
        }
        assertTrue("Real chat login and Figma theme should load", ready.await(1, TimeUnit.SECONDS));
        Thread.sleep(1500);
        screenshot(activity, "android-login.png");
            String script = "document.getElementById('nickname').value='Android 확인';document.getElementById('login-form').requestSubmit();";
            runTestOnUiThread(() -> view.evaluateJavascript(script, null));
            CountDownLatch joined = new CountDownLatch(1);
            for (int i = 0; i < 60 && joined.getCount() > 0; i++) {
                runTestOnUiThread(() -> view.evaluateJavascript("!document.getElementById('workspace').hidden && document.getElementById('send-button').getBoundingClientRect().height>0", value -> {
                    if ("true".equals(value)) joined.countDown();
                }));
                Thread.sleep(200);
            }
            assertTrue("Nickname alone should enter chat", joined.await(1, TimeUnit.SECONDS));
            Thread.sleep(1500);
            CountDownLatch geometry = new CountDownLatch(1);
            runTestOnUiThread(() -> view.evaluateJavascript("['attach-button','send-button'].every(id=>document.getElementById(id).getBoundingClientRect().width>=43.8 && Math.abs(parseFloat(getComputedStyle(document.getElementById(id),'::after').width)-21.6)<0.2) && document.documentElement.scrollWidth<=innerWidth+1", value -> {
                if ("true".equals(value)) geometry.countDown();
            }));
            screenshot(activity, "android-chat.png");
            assertTrue("Figma icons should keep original dimensions without overflow", geometry.await(2, TimeUnit.SECONDS));
            long connectionDeadline = System.currentTimeMillis() + 10000;
            while (!ChatConnectionService.state(activity).contains("instance") && System.currentTimeMillis() < connectionDeadline) Thread.sleep(200);
            assertEquals("Native service should keep the same server boot", server.instanceId,
                ChatConnectionService.state(activity).getString("instance", ""));
            while (!ChatConnectionService.isConnected() && System.currentTimeMillis() < connectionDeadline) Thread.sleep(200);
            assertTrue("Server must accept the native authenticated socket", ChatConnectionService.isConnected());
            runTestOnUiThread(() -> view.evaluateJavascript("state.socket.disconnect()", null));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            Thread.sleep(30000);
            assertEquals("Backgrounding the UI must preserve the server connection", server.instanceId,
                ChatConnectionService.state(activity).getString("instance", ""));
            assertTrue("Native socket must survive even when the WebView socket is stopped", ChatConnectionService.isConnected());
            android.app.ActivityManager manager = activity.getSystemService(android.app.ActivityManager.class);
            assertTrue("Connection must run as a foreground service", manager.getRunningServices(Integer.MAX_VALUE).stream()
                .anyMatch(service -> service.service.getClassName().endsWith("ChatConnectionService") && service.foreground));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            // APK replacement can stop the service while leaving the saved connection intact.
            runTestOnUiThread(() -> activity.stopService(new android.content.Intent(activity, ChatConnectionService.class)));
            long stoppedDeadline = System.currentTimeMillis() + 5000;
            while (ChatConnectionService.isConnected() && System.currentTimeMillis() < stoppedDeadline) Thread.sleep(100);
            scenario.recreate();
            scenario.onActivity(value -> current[0] = value);
            ArrayList<WebView> restoredViews = new ArrayList<>();
            long restoreDeadline = System.currentTimeMillis() + 30000;
            while (restoredViews.isEmpty() && System.currentTimeMillis() < restoreDeadline) {
                runTestOnUiThread(() -> collect(current[0].getWindow().getDecorView(), WebView.class, restoredViews));
                Thread.sleep(200);
            }
            assertEquals("Reopening the Activity should restore the connected room", 1, restoredViews.size());
            WebView restored = restoredViews.get(0);
            CountDownLatch restoredRoom = new CountDownLatch(1);
            for (int i = 0; i < 60 && restoredRoom.getCount() > 0; i++) {
                runTestOnUiThread(() -> restored.evaluateJavascript("Boolean(document.getElementById('workspace') && !document.getElementById('workspace').hidden)", value -> {
                    if ("true".equals(value)) restoredRoom.countDown();
                }));
                Thread.sleep(200);
            }
            assertTrue("The same session must reopen without another nickname entry", restoredRoom.await(1, TimeUnit.SECONDS));
            long resumedDeadline = System.currentTimeMillis() + 10000;
            while (!ChatConnectionService.isConnected() && System.currentTimeMillis() < resumedDeadline) Thread.sleep(200);
            assertTrue("Restoration must restart a stopped native connection service", ChatConnectionService.isConnected());
            runTestOnUiThread(() -> restored.evaluateJavascript("document.getElementById('logout').click()", null));
            long leaveDeadline = System.currentTimeMillis() + 10000;
            while (ChatConnectionService.state(activity).contains("instance") && System.currentTimeMillis() < leaveDeadline) Thread.sleep(200);
            assertFalse("Explicit logout must stop the background connection", ChatConnectionService.state(activity).contains("instance"));
        }
    }
    @Test public void staleSavedConnectionDoesNotLoadACloudflareErrorPage() throws Exception {
        Assume.assumeFalse(closedMode());
        android.content.Context context = getInstrumentation().getTargetContext();
        ServerLocator.Server current = new ServerLocator().locate();
        ChatConnectionService.state(context).edit().putString("url", current.url)
            .putString("instance", "00000000-0000-0000-0000-000000000000")
            .putString("cookie", "chat_session=obsolete-session").commit();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            MainActivity[] activity = new MainActivity[1]; scenario.onActivity(value -> activity[0] = value);
            long deadline = System.currentTimeMillis() + 15000;
            while (ChatConnectionService.state(context).contains("instance") && System.currentTimeMillis() < deadline) Thread.sleep(200);
            assertFalse("A saved connection to a different boot must be cleared", ChatConnectionService.state(context).contains("instance"));
            getInstrumentation().waitForIdleSync();
            ArrayList<WebView> views = new ArrayList<>(); ArrayList<Button> buttons = new ArrayList<>();
            long entryDeadline = System.currentTimeMillis() + 10000;
            while (System.currentTimeMillis() < entryDeadline) {
                buttons.clear();
                runTestOnUiThread(() -> collect(activity[0].getWindow().getDecorView(), Button.class, buttons));
                if (buttons.size() == 1 && buttons.get(0).isEnabled() && "서버 입장".contentEquals(buttons.get(0).getText())) break;
                Thread.sleep(200);
            }
            buttons.clear();
            runTestOnUiThread(() -> {
                collect(activity[0].getWindow().getDecorView(), WebView.class, views);
                collect(activity[0].getWindow().getDecorView(), Button.class, buttons);
            });
            assertTrue("The stale address must never open an error WebView", views.isEmpty());
            assertEquals(1, buttons.size()); assertEquals("서버 입장", buttons.get(0).getText().toString());
            assertTrue(buttons.get(0).isEnabled());
        } finally { ChatConnectionService.disconnect(context); }
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
