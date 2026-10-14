package com.moeum.chat;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

final class PushNotifications {
    static final String CHANNEL = "moeum_ring";
    static void channel(Context context) {
        NotificationChannel channel = new NotificationChannel(CHANNEL, "채팅 알림 울리기", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("친구가 알림을 울리면 소리와 진동으로 알려 줍니다.");
        channel.enableVibration(true);
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
    static void show(Context context, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        channel(context);
        Intent open = new Intent(context, MainActivity.class).putExtra("action", "ring")
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_notification)
            .setColor(0xffff51cc).setContentTitle(title).setContentText(body)
            .setStyle(new Notification.BigTextStyle().bigText(body)).setContentIntent(tap).setAutoCancel(true).build();
        context.getSystemService(NotificationManager.class).notify(100, notification);
    }
}
