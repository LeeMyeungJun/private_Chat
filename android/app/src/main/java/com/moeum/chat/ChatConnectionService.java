package com.moeum.chat;

import android.app.Service;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.IBinder;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import io.socket.client.IO;
import io.socket.client.Socket;
import java.util.Collections;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** An authenticated connection independent of the Activity and WebView lifecycle. */
public final class ChatConnectionService extends Service {
    private static final String CHANNEL = "moeum_connection", STOP = "disconnect";
    private Socket socket;
    private ScheduledExecutorService health;
    private String instance, activeCookie;
    private static volatile boolean connected;
    static boolean isConnected() { return connected; }
    static SharedPreferences state(Context context) { return context.getSharedPreferences("connection", MODE_PRIVATE); }
    static String topic(String instance) { return "moeum-room-" + instance; }
    static void subscribe(Context context, String instance, boolean enabled) {
        if (instance == null || FirebaseApp.initializeApp(context) == null) return;
        if (enabled) FirebaseMessaging.getInstance().subscribeToTopic(topic(instance));
        else FirebaseMessaging.getInstance().unsubscribeFromTopic(topic(instance));
    }
    static void disconnect(Context context) {
        String previous = state(context).getString("instance", null);
        String url = state(context).getString("url", ""), cookie = state(context).getString("cookie", "");
        state(context).edit().clear().apply(); subscribe(context, previous, false);
        context.stopService(new Intent(context, ChatConnectionService.class));
        if (ServerLocator.allowedAddress(url) && !cookie.isEmpty()) new Thread(() -> {
            java.net.HttpURLConnection connection = null;
            try {
                connection = (java.net.HttpURLConnection) new java.net.URL(url + "/api/logout").openConnection();
                connection.setConnectTimeout(6000); connection.setReadTimeout(6000);
                connection.setInstanceFollowRedirects(false); connection.setRequestMethod("POST");
                connection.setRequestProperty("Cookie", cookie); connection.getResponseCode();
            } catch (Exception ignored) { /* A closed server has already discarded this session. */ }
            finally { if (connection != null) connection.disconnect(); }
        }, "moeum-disconnect").start();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { disconnect(this); return START_NOT_STICKY; }
        SharedPreferences saved = state(this);
        String url = saved.getString("url", ""), cookie = saved.getString("cookie", "");
        String requested = saved.getString("instance", "");
        if (!ServerLocator.allowedAddress(url) || !requested.matches("[0-9a-f-]{36}") || cookie.isEmpty()) {
            stopSelf(); return START_NOT_STICKY;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL, "서버 연결 유지", NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null); getSystemService(NotificationManager.class).createNotificationChannel(channel);
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent tap = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent leave = new Intent(this, ChatConnectionService.class).setAction(STOP);
        PendingIntent stop = PendingIntent.getService(this, 2, leave, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notice = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("모음 · 서버 연결 유지 중").setContentText("다른 앱을 사용해도 연결과 알림을 유지합니다.")
            .setContentIntent(tap).setOngoing(true).addAction(new Notification.Action.Builder(null, "연결 끊기", stop).build()).build();
        startForeground(101, notice);
        if (requested.equals(instance) && cookie.equals(activeCookie) && socket != null) return START_STICKY;
        release(); instance = requested; activeCookie = cookie; subscribe(this, instance, true);
        try {
            IO.Options options = new IO.Options();
            options.extraHeaders = Collections.singletonMap("Cookie", Collections.singletonList(cookie));
            options.reconnection = true; options.reconnectionAttempts = Integer.MAX_VALUE;
            options.reconnectionDelay = 1000; options.reconnectionDelayMax = 10000;
            socket = IO.socket(url, options);
            socket.on(Socket.EVENT_CONNECT, args -> { connected = true; });
            // Authentication/network errors do not revoke a previously joined room's FCM subscription.
            socket.on("server:closed", args -> disconnect(this));
            socket.on(Socket.EVENT_DISCONNECT, args -> {
                connected = false;
                if (args.length > 0 && "io server disconnect".equals(String.valueOf(args[0]))) disconnect(this);
            });
            socket.connect();
            ServerLocator.Server server = new ServerLocator.Server(url, instance);
            health = Executors.newSingleThreadScheduledExecutor();
            health.scheduleWithFixedDelay(() -> {
                // A temporary loss of mobile internet is retried, never treated as leaving the room.
                ConnectivityManager connectivity = getSystemService(ConnectivityManager.class);
                NetworkCapabilities capabilities = connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
                if (capabilities == null || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return;
                try {
                    if (!new ServerLocator().alive(server)) { disconnect(this); return; }
                } catch (Exception ignored) {
                    // Timeouts, Cloudflare errors and Doze are not evidence of server shutdown.
                    // Keep the saved session and topic; Socket.IO retries independently.
                }
            }, 10, 10, TimeUnit.MINUTES);
        } catch (Exception error) {
            // Preserve push even if opening the native socket fails.
            android.util.Log.w("MoeumConnection", "Connection setup failed; room subscription retained");
        }
        return START_STICKY;
    }
    private void release() {
        connected = false;
        if (health != null) { health.shutdownNow(); health = null; }
        if (socket != null) { socket.off(); socket.disconnect(); socket = null; }
    }
    @Override public void onDestroy() { release(); stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy(); }
}
